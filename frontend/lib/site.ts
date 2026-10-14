// Who runs this Craton deployment and how to reach them. Set per deployment; nothing is invented
// when they're missing (pages say how to reach the maintainers instead). Server only.

/** General contact, e.g. support@your-domain. */
export const CONTACT_EMAIL = process.env.CRATON_CONTACT_EMAIL || null;
/** Where to report vulnerabilities; falls back to the general contact. */
export const SECURITY_EMAIL = process.env.CRATON_SECURITY_EMAIL || CONTACT_EMAIL;
