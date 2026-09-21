/**
 * Sanitises a string to be a safe directory or file name across platforms.
 */
export function sanitiseSegment(name: string): string {
    // Strip reserved characters: / \ ? % * : | " < >
    let safe = name.replace(/[/?%*:|"<>\\]/g, "");

    // Remove control characters
    // eslint-disable-next-line no-control-regex
    safe = safe.replace(/[\x00-\x1F\x7F]/g, "");

    // Strip trailing dots and spaces (Windows restriction)
    safe = safe.replace(/[.\s]+$/, "");

    // Windows reserved names
    const reservedNames = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
    if (reservedNames.test(safe)) {
        safe = `_${safe}`;
    }

    // Default if empty
    if (safe.length === 0) {
        safe = "unnamed";
    }

    // Truncate if too long (255 chars is a safe limit on most filesystems)
    if (safe.length > 255) {
        safe = safe.substring(0, 255);
        // Truncating might leave trailing dots/spaces again
        safe = safe.replace(/[.\s]+$/, "");
        if (safe.length === 0) {
            safe = "unnamed";
        }
    }

    return safe;
}

/**
 * Ensures a name is unique within a given set of taken names.
 * Does a case-insensitive comparison, as Windows/macOS are mostly case-insensitive.
 */
export function uniqueInDirectory(name: string, taken: Set<string>): string {
    const takenLower = new Set(Array.from(taken).map(s => s.toLowerCase()));

    let candidate = name;
    let candidateLower = candidate.toLowerCase();
    let counter = 1;

    while (takenLower.has(candidateLower)) {
        candidate = `${name}_${counter}`;
        candidateLower = candidate.toLowerCase();
        counter++;
    }

    return candidate;
}
