// api/index.js
import app from "../app.js";

// Vercel butuh handler function
export default function handler(req, res) {
  return app(req, res);
}
