export function asyncOnce<T extends (...args: any[]) => Promise<any>>(
    fn: T,
): T {
    let promise: ReturnType<T> | undefined;
    return ((...args: any[]) => {
        if (!promise) {
            promise = fn(...args);
        }
        return promise;
    }) as unknown as T;
}
