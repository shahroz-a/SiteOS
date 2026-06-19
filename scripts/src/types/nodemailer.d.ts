// Minimal ambient declaration for nodemailer. The published package ships no
// types and `@types/nodemailer` isn't installable through this environment's
// package firewall, so we declare just the surface `check-redirect-targets.ts`
// uses (a structurally-typed `NodemailerModule` casts over this).
declare module "nodemailer";
