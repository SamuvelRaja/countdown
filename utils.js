// tiny time utils used by the front-end
export function pad(n, width = 2) { return String(n).padStart(width, '0'); }

export function formatDistanceStrict(a, b) {
    const diff = b - a;
    if (diff <= 0) return '0d 0h 0m';
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    return `${days}d ${hours}h ${minutes}m`;
}
