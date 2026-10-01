import { promises as fs } from 'node:fs';

/** 读取字幕文件并统一转换为 WebVTT 文本 */
export async function toVtt(subPath: string): Promise<string> {
  const ext = subPath.slice(subPath.lastIndexOf('.') + 1).toLowerCase();
  const raw = await fs.readFile(subPath, 'utf8');
  const text = stripBom(raw);
  if (ext === 'vtt') return text;
  if (ext === 'srt') return srtToVtt(text);
  if (ext === 'ass' || ext === 'ssa') return assToVtt(text);
  return 'WEBVTT\n\n';
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** SRT -> VTT：时间轴逗号改点，过滤序号行 */
function srtToVtt(srt: string): string {
  const body = srt
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    // 删除纯序号行
    .split('\n')
    .filter((line) => !/^\d+$/.test(line.trim()))
    .join('\n');
  return `WEBVTT\n\n${body.trim()}\n`;
}

const ASS_TIME = /(\d+):(\d{2}):(\d{2})\.(\d{2})/;

/** ASS 时间 -> VTT 时间 */
function assTimeToVt(m: RegExpMatchArray): string {
  const [, h, mm, ss, cs] = m;
  return `${h.padStart(2, '0')}:${mm}:${ss}.${cs}0`;
}

/** ASS -> 基础 VTT：仅解析 [Events] 中 Dialogue 行的时间与文本，忽略样式 */
function assToVtt(ass: string): string {
  const lines = ass.replace(/\r\n?/g, '\n').split('\n');
  let inEvents = false;
  const cues: string[] = [];
  for (const line of lines) {
    if (/^\[.*\]$/.test(line.trim())) {
      inEvents = /^\[events\]$/i.test(line.trim());
      continue;
    }
    if (!inEvents || !line.startsWith('Dialogue:')) continue;
    // Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
    const parts = line.slice('Dialogue:'.length).split(',');
    if (parts.length < 10) continue;
    const start = parts[1].match(ASS_TIME);
    const end = parts[2].match(ASS_TIME);
    if (!start || !end) continue;
    // 文本可能包含逗号，取第 9 段之后重新拼接
    const text = parts.slice(9).join(',');
    const plain = text
      .replace(/\{[^}]*\}/g, '') // 覆盖标签 {\...}
      .replace(/\\N/g, '\n')
      .replace(/\\[hn]/g, ' ')
      .trim();
    if (!plain) continue;
    cues.push(`${assTimeToVt(start)} --> ${assTimeToVt(end)}\n${plain}\n`);
  }
  return `WEBVTT\n\n${cues.join('\n')}`;
}
