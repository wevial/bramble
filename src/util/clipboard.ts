import { spawn } from 'node:child_process';

/**
 * Write `text` to the system clipboard. Picks a native CLI per-platform
 * (pbcopy on macOS, wl-copy/xclip on Linux). Resolves on success, rejects
 * with a short explanation if no supported binary is available.
 */
export function copyToClipboard(text: string): Promise<void> {
  const cmd = pickClipboardCmd();
  if (!cmd) {
    return Promise.reject(
      new Error(
        'no clipboard binary found (tried pbcopy, wl-copy, xclip). install one or copy manually',
      ),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.cmd, cmd.args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr?.on('data', chunk => (err += chunk.toString()));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd.cmd} exited ${code}${err ? `: ${err.trim()}` : ''}`));
    });
    child.stdin?.write(text);
    child.stdin?.end();
  });
}

function pickClipboardCmd(): { cmd: string; args: string[] } | null {
  if (process.platform === 'darwin') return { cmd: 'pbcopy', args: [] };
  if (process.env['WAYLAND_DISPLAY']) return { cmd: 'wl-copy', args: [] };
  if (process.env['DISPLAY']) return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
  return null;
}
