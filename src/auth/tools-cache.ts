import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Caches the discovered tool list to disk so that subsequent launches
 * can return the full tool list instantly (within Claude Desktop's
 * 5-second tools/list timeout).
 *
 * The cache is populated during `npm run login` (which runs full discovery)
 * and loaded at startup to serve the first tools/list response.
 *
 * Storage location: ~/.agent365-bridge/tools-cache.json
 */

const CACHE_DIR = path.join(os.homedir(), ".agent365-bridge");
const TOOLS_CACHE_FILE = path.join(CACHE_DIR, "tools-cache.json");

/** Max age of the cache before it's considered stale (24 hours) */
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    serverName: string;
}

interface ToolsCache {
    timestamp: number;
    tools: CachedTool[];
}

function log(message: string): void {
    process.stderr.write(`[agent365-bridge] ${message}\n`);
}

/**
 * Saves the discovered tool list to disk.
 */
export function saveToolsCache(tools: CachedTool[]): void {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cache: ToolsCache = {
        timestamp: Date.now(),
        tools,
    };

    fs.writeFileSync(TOOLS_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
    log(`Cached ${tools.length} tools to ${TOOLS_CACHE_FILE}`);
}

/**
 * Loads the cached tool list from disk.
 * Returns null if no cache exists or if it's too old.
 */
export function loadToolsCache(): CachedTool[] | null {
    try {
        if (!fs.existsSync(TOOLS_CACHE_FILE)) {
            return null;
        }

        const raw = fs.readFileSync(TOOLS_CACHE_FILE, "utf-8");
        const cache: ToolsCache = JSON.parse(raw);

        // Check if cache is stale
        const age = Date.now() - cache.timestamp;
        if (age > MAX_CACHE_AGE_MS) {
            log(`Tool cache is stale (${Math.round(age / 3600000)}h old), ignoring`);
            return null;
        }

        log(`Loaded ${cache.tools.length} cached tools (${Math.round(age / 60000)}m old)`);
        return cache.tools;
    } catch (err) {
        log(`Failed to load tool cache: ${err}`);
        return null;
    }
}

/**
 * Clears the cached tool list.
 */
export function clearToolsCache(): void {
    try {
        if (fs.existsSync(TOOLS_CACHE_FILE)) {
            fs.unlinkSync(TOOLS_CACHE_FILE);
        }
    } catch {
        // ignore
    }
}
