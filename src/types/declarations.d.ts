/**
 * Custom type declarations for modules without types
 */

declare module 'node-fetch' {
    export default function fetch(
        url: string,
        options?: {
            method?: string;
            headers?: Record<string, string>;
            body?: string;
            signal?: AbortSignal;
            timeout?: number;
        }
    ): Promise<{
        ok: boolean;
        status: number;
        statusText: string;
        text(): Promise<string>;
        json(): Promise<unknown>;
    }>;
}
