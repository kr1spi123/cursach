import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function tryLoadEnv() {
  const candidates = [
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
  if (!process.env.TELEGRAM_TOKEN) {
    dotenv.config();
  }
}

tryLoadEnv();

export const config = {
  token: process.env.TELEGRAM_TOKEN || "",
  institutionName: process.env.INSTITUTION_NAME || "колледжа",
  websiteUrl: process.env.WEBSITE_URL || "",
  contactPhone: process.env.CONTACT_PHONE || "",
  contactEmail: process.env.CONTACT_EMAIL || "",
};
