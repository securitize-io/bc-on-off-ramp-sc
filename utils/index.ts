export function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Utility functions for colored console logs
export const consoleGreen = (message: string) => console.log('\x1b[32m%s\x1b[0m', message); // Green color
export const consoleYellow = (message: string) => console.log('\x1b[33m%s\x1b[0m', message); // Yellow color
export const consoleRed = (message: string) => console.log('\x1b[31m%s\x1b[0m', message); // Red color
export const consoleBlue = (message: string) => console.log('\x1b[34m%s\x1b[0m', message); // Blue color
export const consoleMagenta = (message: string) => console.log('\x1b[35m%s\x1b[0m', message); // Magenta color
export const consoleCyan = (message: string) => console.log('\x1b[36m%s\x1b[0m', message); // Cyan color
export const consoleWhite = (message: string) => console.log('\x1b[37m%s\x1b[0m', message); // White color
export const consoleGray = (message: string) => console.log('\x1b[90m%s\x1b[0m', message); // Gray color
export const consoleBright = (message: string) => console.log('\x1b[1m%s\x1b[0m', message); // Bright text
