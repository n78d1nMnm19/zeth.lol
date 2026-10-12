const { json } = require("./_store");

exports.handler = async () => json(200, { ok: true, host: "netlify" });
