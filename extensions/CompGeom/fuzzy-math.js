
export const TOL = 1e-6;

export function isZero(f) {
    return Math.abs(f) < TOL;
}

export function isEqual(a, b) {
    return isZero(a - b);
}