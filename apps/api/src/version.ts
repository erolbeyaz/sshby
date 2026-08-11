/** Build sırasında imaja gömülür (Dockerfile `ARG APP_VERSION`). */
export const APP_VERSION = process.env.APP_VERSION ?? '0.1.0-dev';
