import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

function tempSibling(filePath: string): string {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    return path.join(dir, `.${base}.${randomUUID()}.tmp`);
}

async function replaceWith(tempPath: string, filePath: string): Promise<void> {
    try {
        await fsp.rename(tempPath, filePath);
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
            await fsp.unlink(filePath);
            await fsp.rename(tempPath, filePath);
            return;
        }
        throw error;
    }
}

function replaceWithSync(tempPath: string, filePath: string): void {
    try {
        fs.renameSync(tempPath, filePath);
    } catch (error: unknown) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'EPERM' || code === 'EACCES') {
            fs.unlinkSync(filePath);
            fs.renameSync(tempPath, filePath);
            return;
        }
        throw error;
    }
}

async function writeAtomic(
    filePath: string,
    contents: string | Buffer,
    encoding?: BufferEncoding,
): Promise<void> {
    const dir = path.dirname(filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tempPath = tempSibling(filePath);
    try {
        if (typeof contents === 'string') {
            await fsp.writeFile(tempPath, contents, encoding ?? 'utf8');
        } else {
            await fsp.writeFile(tempPath, contents);
        }
        await replaceWith(tempPath, filePath);
    } catch (error) {
        try {
            await fsp.unlink(tempPath);
        } catch {
            // temp may already have been renamed
        }
        throw error;
    }
}

/**
 * Write `contents` to `filePath` via a same-directory temp file + rename so a
 * crash cannot leave a truncated target. Temp files are unlinked on failure.
 */
export async function writeFileAtomic(
    filePath: string,
    contents: string,
    encoding: BufferEncoding = 'utf8',
): Promise<void> {
    await writeAtomic(filePath, contents, encoding);
}

/** Atomic replace for binary blob objects (raw or gzip). */
export async function writeBufferAtomic(filePath: string, contents: Buffer): Promise<void> {
    await writeAtomic(filePath, contents);
}

export function writeFileAtomicSync(
    filePath: string,
    contents: string,
    encoding: BufferEncoding = 'utf8',
): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tempPath = tempSibling(filePath);
    try {
        fs.writeFileSync(tempPath, contents, encoding);
        replaceWithSync(tempPath, filePath);
    } catch (error) {
        try {
            fs.unlinkSync(tempPath);
        } catch {
            // temp may already have been renamed
        }
        throw error;
    }
}
