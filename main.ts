// gta6-clipper-01 — the entry program (Node 22, standard library only).
//
// Two jobs, one file:
//
//   1. Hand in the video. Run with no flags, this reads VIDEO.json from the
//      repository and writes it to the grader's output directory. That copy
//      is the whole graded behaviour: the house reads the video itself from
//      YouTube, so nothing this program says about the video is scored.
//      It prints nothing on success.
//
//   2. Rebuild the clip. Run with --render, this also re-cuts the published
//      Short from the Rockstar GTA 6 Trailer 2 source with ffmpeg: the
//      40-second Jason moment, center-cropped to vertical 1080x1920, with
//      make.fun's pitch burned over the last six seconds. The render needs
//      a trailer file (pass --trailer) and ffmpeg on PATH; it never runs in
//      the grader, which has neither, so a plain run always just does job 1.
//
// Usage:
//   node main.ts                                   # hand in VIDEO.json only
//   node main.ts --render --trailer trailer.mp4    # rebuild the clip, then hand in
//   node main.ts --render --trailer t.mp4 --subtitles gta6-01.srt --out clip.mp4
//   node main.ts --render --dry-run --trailer t.mp4   # print the ffmpeg command only

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The repository this file lives in: the fallback for MAKEFUN_BOT_DIR when
// the grader has not set it, so a plain local run hands in this repo's
// VIDEO.json instead of looking for a /bot directory that is not there.
const REPO_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// The clip itself: the creative decisions behind the published Short.
// ---------------------------------------------------------------------------

// The hook: Jason in the car, talking property and tenants, "Love you, Jason".
// Ten seconds into Trailer 2, forty seconds long — the whole opening beat.
const HOOK_START_SEC = 10;
const HOOK_LENGTH_SEC = 40;

// The pitch runs over the last six seconds of the clip, three lines, each
// long enough to read, sitting in the vertical frame's safe area.
const PITCH_START_SEC = 34;
const PITCH_END_SEC = 40;
const PITCH_LINES = [
  'Make clips like this with AI',
  'and earn money on make.fun',
  'make.fun/bounty/gta6-clipper-01',
];

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;
const PITCH_FONT_SIZE = 54;
const DEFAULT_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// ffmpeg's drawtext treats backslash, quote, colon and percent as special
// inside a text value, so each of them gets escaped before it goes in.
function escapeDrawtext(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%');
}

function fail(message: string): never {
  console.error(`gta6-clipper-01: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Job 1: hand VIDEO.json in.
// ---------------------------------------------------------------------------

function handInVideo(repoDir: string, outputDir: string): void {
  const sourcePath = join(repoDir, 'VIDEO.json');
  const raw = readFileSync(sourcePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { url?: unknown }).url !== 'string') {
    fail(`VIDEO.json in ${repoDir} is not an object with a string url`);
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'VIDEO.json'), raw);
}

// ---------------------------------------------------------------------------
// Job 2: rebuild the clip with ffmpeg.
// ---------------------------------------------------------------------------

interface RenderOptions {
  trailerPath: string;
  subtitlesPath: string | null;
  outputPath: string;
  fontPath: string;
  dryRun: boolean;
}

function buildFilterGraph(subtitlesPath: string | null, fontPath: string): string {
  const stages: string[] = [
    // 16:9 frame -> vertical 9:16, centred on the action, then to 1080x1920.
    'crop=ih*9/16:ih',
    `scale=${FRAME_WIDTH}:${FRAME_HEIGHT}`,
  ];
  if (subtitlesPath !== null) {
    // English captions, burned in first so the pitch draws over them.
    stages.push(`subtitles=filename='${subtitlesPath.replace(/'/g, "\\'")}'`);
  }
  // A dim panel behind the pitch block, so the words stay readable over
  // any footage, and the bounty link in yellow so it stands out.
  stages.push(
    `drawbox=x=0:y=1280:w=${FRAME_WIDTH}:h=260:color=black@0.55:t=fill` +
      `:enable='between(t,${PITCH_START_SEC},${PITCH_END_SEC})'`,
  );
  // One drawtext per pitch line, stacked above the bottom buttons, only
  // visible while the pitch window runs.
  const lineHeight = PITCH_FONT_SIZE + 26;
  const firstLineY = FRAME_HEIGHT - 620;
  for (let i = 0; i < PITCH_LINES.length; i++) {
    const y = firstLineY + i * lineHeight;
    const color = i === PITCH_LINES.length - 1 ? 'yellow' : 'white';
    stages.push(
      `drawtext=fontfile=${fontPath}:text='${escapeDrawtext(PITCH_LINES[i])}'` +
        `:fontsize=${PITCH_FONT_SIZE}:fontcolor=${color}:borderw=3:bordercolor=black` +
        `:x=(w-text_w)/2:y=${y}` +
        `:enable='between(t,${PITCH_START_SEC},${PITCH_END_SEC})'`,
    );
  }
  return stages.join(',');
}

function renderClip(opts: RenderOptions): void {
  if (!existsSync(opts.trailerPath)) {
    fail(`trailer not found: ${opts.trailerPath}`);
  }
  if (opts.subtitlesPath !== null && !existsSync(opts.subtitlesPath)) {
    fail(`subtitles not found: ${opts.subtitlesPath}`);
  }
  if (!existsSync(opts.fontPath)) {
    fail(`pitch font not found: ${opts.fontPath}`);
  }
  const filterGraph = buildFilterGraph(opts.subtitlesPath, opts.fontPath);
  const ffmpegArgs = [
    '-ss', String(HOOK_START_SEC),
    '-t', String(HOOK_LENGTH_SEC),
    '-i', opts.trailerPath,
    '-vf', filterGraph,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    '-y', opts.outputPath,
  ];
  if (opts.dryRun) {
    console.log(['ffmpeg', ...ffmpegArgs].join(' '));
    return;
  }
  const run = spawnSync('ffmpeg', ffmpegArgs, { encoding: 'utf8' });
  if (run.error) {
    fail(`could not start ffmpeg: ${(run.error as Error).message}`);
  }
  if (run.status !== 0) {
    console.error((run.stderr ?? '').slice(-2000));
    fail(`ffmpeg exited with status ${run.status}`);
  }
  console.log(`rendered ${opts.outputPath} (${HOOK_LENGTH_SEC}s, ${FRAME_WIDTH}x${FRAME_HEIGHT})`);
}

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(
    'usage: node main.ts [--render] [--trailer <file>] [--subtitles <file>] ' +
      '[--out <file>] [--font <file>] [--dry-run] [--help]',
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  let render = false;
  let dryRun = false;
  let trailerPath: string | null = process.env.GTA6_TRAILER ?? null;
  let subtitlesPath: string | null = null;
  let outputPath = join(process.cwd(), 'gta6-01-pitch.mp4');
  let fontPath = process.env.GTA6_PITCH_FONT ?? DEFAULT_FONT;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const takeValue = (flag: string): string => {
      if (next === undefined) fail(`${flag} needs a value`);
      i++;
      return next;
    };
    if (arg === '--render') render = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help') { printUsage(); return; }
    else if (arg === '--trailer') trailerPath = resolve(takeValue(arg));
    else if (arg === '--subtitles') subtitlesPath = resolve(takeValue(arg));
    else if (arg === '--out') outputPath = resolve(takeValue(arg));
    else if (arg === '--font') fontPath = resolve(takeValue(arg));
    else fail(`unknown argument: ${arg}`);
  }

  if (render) {
    if (trailerPath === null) {
      fail('--render needs --trailer <file> (or GTA6_TRAILER)');
    }
    renderClip({
      trailerPath: resolve(trailerPath),
      subtitlesPath,
      outputPath,
      fontPath,
      dryRun,
    });
    // A dry run prints the ffmpeg command and stops there: it must not
    // touch VIDEO.json or need the grader's directories to exist.
    if (dryRun) return;
  }

  const repoDir = process.env.MAKEFUN_BOT_DIR ?? REPO_DIR;
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  handInVideo(repoDir, outputDir);
}

main();
