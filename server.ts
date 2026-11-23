import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import cookieParser from "cookie-parser";
import multer from "multer";
import { Readable } from "stream";
import axios from "axios";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { AssinafyClient } from "@assinafy/sdk";
import fs from "fs";
import crypto from "crypto";
import Database from "better-sqlite3";

const _filename = typeof __filename !== "undefined"
  ? __filename
  : (import.meta && import.meta.url ? fileURLToPath(import.meta.url) : "server.ts");
const _dirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(_filename);

const logDebug = (msg: string) => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(path.join(process.cwd(), "debug_drive.log"), line);
  } catch (e) {
    console.error("Error writing to debug_drive.log:", e);
  }
};

const responseToBuffer = async (data: any): Promise<Buffer> => {
  if (!data) {
    throw new Error("Dados da resposta estão vazios");
  }
  // Se for um Stream (Readable)
  if (data.on && typeof data.on === "function") {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      data.on("data", (chunk: any) => chunks.push(Buffer.from(chunk)));
      data.on("end", () => resolve(Buffer.concat(chunks)));
      data.on("error", (err: any) => reject(err));
    });
  }
  // Se já for um Buffer
  if (Buffer.isBuffer(data)) {
    return data;
  }
  // Se for ArrayBuffer ou Uint8Array
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return Buffer.from(data as any);
  }
  // Se for qualquer outra coisa (ex: string)
  return Buffer.from(String(data));
};

const getOAuth2Client = (reqOrHost?: any, explicitRedirectUri?: string) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || "675095875960-lgiit33brqq2tumt3k0mt78ee06bf1tu.apps.googleusercontent.com";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  
  if (explicitRedirectUri) {
    return new google.auth.OAuth2(clientId, clientSecret, explicitRedirectUri);
  }

  let requestHost = "";
  if (typeof reqOrHost === "string") {
    requestHost = reqOrHost;
  } else if (reqOrHost && typeof reqOrHost === "object") {
    requestHost = (reqOrHost.headers?.["x-forwarded-host"] as string) || reqOrHost.headers?.host || "";
  }

  let appUrl = "";
  if (requestHost && (requestHost.includes("run.app") || !requestHost.includes("localhost"))) {
    appUrl = `https://${requestHost}`;
  } else {
    appUrl = process.env.APP_URL || "https://ais-dev-mnko3fredg5cl6fz5xbf3b-366038558643.us-east1.run.app";
    if (appUrl.startsWith("http://localhost") && requestHost && !requestHost.includes("localhost")) {
      appUrl = `https://${requestHost}`;
    }
  }
  
  appUrl = appUrl.replace(/\/$/, "");
  const redirectUri = `${appUrl}/api/auth/google/callback`;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
};

// In-memory token storage for environments where iframe blocks third-party cookies
let inMemoryGoogleTokens: any = null;

const extractGoogleTokens = (req: any): any | null => {
  if (!req) return inMemoryGoogleTokens;

  // 1. Check Authorization header (Bearer <access_token> or Bearer <json>)
  const authHeader = req.headers?.authorization;
  if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const raw = authHeader.substring(7).trim();
    if (raw.startsWith("{")) {
      try { return JSON.parse(raw); } catch (e) {}
    } else if (raw) {
      return { access_token: raw };
    }
  }

  // 2. Check x-google-tokens header (custom header sent by frontend)
  const customHeader = req.headers?.["x-google-tokens"];
  if (typeof customHeader === "string" && customHeader.trim()) {
    try {
      const parsed = JSON.parse(customHeader);
      if (parsed && (parsed.access_token || parsed.refresh_token)) {
        return parsed;
      }
    } catch (e) {}
  }

  // 3. Check request body
  if (req.body?.google_tokens) {
    if (typeof req.body.google_tokens === "object") return req.body.google_tokens;
    try { return JSON.parse(req.body.google_tokens); } catch (e) {}
  }

  // 4. Check cookies
  const cookieStr = req.cookies?.google_tokens;
  if (cookieStr) {
    try {
      const parsed = typeof cookieStr === "object" ? cookieStr : JSON.parse(cookieStr);
      if (parsed && (parsed.access_token || parsed.refresh_token)) {
        return parsed;
      }
    } catch (e) {}
  }

  // 5. Fallback to active in-memory tokens
  if (inMemoryGoogleTokens) {
    return inMemoryGoogleTokens;
  }

  return null;
};

const isGoogleAuthError = (error: any) => {
  if (!error) return false;
  
  const getMessage = (val: any) => {
    if (typeof val === 'string') return val.toLowerCase();
    if (typeof val === 'object' && val !== null) {
      try {
        return JSON.stringify(val).toLowerCase();
      } catch (e) {
        return "";
      }
    }
    return "";
  };

  const message = getMessage(error.message);
  const data = error.response?.data;
  const dataStr = getMessage(data);
  const status = error.response?.status || error.code;

  return (
    status === 401 ||
    message.includes("invalid_grant") ||
    dataStr.includes("invalid_grant") ||
    message.includes("invalid token") ||
    dataStr.includes("invalid token") ||
    message.includes("expired") ||
    dataStr.includes("expired") ||
    message.includes("unauthorized") ||
    dataStr.includes("unauthorized")
  );
};

const isApiDisabledError = (error: any) => {
  if (!error) return false;
  const message = (error.message || "").toLowerCase();
  const data = error.response?.data;
  const dataStr = typeof data === 'object' ? JSON.stringify(data).toLowerCase() : String(data || "").toLowerCase();
  
  return message.includes("has not been used in project") || 
         dataStr.includes("has not been used in project") || 
         message.includes("is disabled") ||
         dataStr.includes("is disabled") ||
         message.includes("enable it by visiting") ||
         dataStr.includes("enable it by visiting");
};

const setCredentialsAndListen = (auth: any, tokens: any, res?: any) => {
  auth.setCredentials(tokens);
  inMemoryGoogleTokens = tokens;
  auth.on("tokens", (newTokens: any) => {
    console.log("[OAuth] Token auto-refreshed, updating in-memory & cookie credentials.");
    const mergedTokens = { ...tokens, ...newTokens };
    inMemoryGoogleTokens = mergedTokens;
    if (res && res.cookie) {
      try {
        res.cookie("google_tokens", JSON.stringify(mergedTokens), {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      } catch (e) {}
    }
  });
};

const clearGoogleTokensCookie = (res?: any) => {
  inMemoryGoogleTokens = null;
  if (res && res.clearCookie) {
    try {
      res.clearCookie("google_tokens", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
      });
    } catch (e) {}
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      if (req.originalUrl && req.originalUrl.startsWith("/api/clicksign/webhook")) {
        req.rawBody = buf;
      }
    }
  }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.use(cookieParser());

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
  });

  // Middleware to allow iframes & universal CORS for APIs / Webhooks
  app.use((req, res, next) => {
    res.removeHeader("X-Frame-Options");
    res.setHeader("Content-Security-Policy", "frame-ancestors *;");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Api-Key, X-Webhook-Token, X-External-App-Token, X-External-Token, X-Requested-With, Origin, x-source, x-webhook-url");

    // Handle preflight OPTIONS requests immediately
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    // Ensure all /api responses default to application/json
    if (req.path.startsWith("/api")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }

    next();
  });

  // Google Auth Routes
  app.get("/api/auth/google/login", (req, res) => {
    const client = getOAuth2Client(req.headers.host);
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      prompt: "consent",
    });
    res.redirect(url);
  });

  app.get("/api/auth/google/url", (req, res) => {
    const client = getOAuth2Client(req.headers.host);
    const url = client.generateAuthUrl({
      access_type: "offline",
      scope: [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/gmail.send",
      ],
      prompt: "consent",
    });
    res.json({ url });
  });

  app.get("/api/auth/google/tokens", (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (tokens) {
      return res.json({ success: true, tokens });
    }
    res.status(404).json({ success: false, error: "Nenhum token encontrado" });
  });

  app.get("/api/auth/google/user-info", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens?.access_token) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    try {
      const auth = getOAuth2Client(req.headers.host);
      auth.setCredentials(tokens);
      const oauth2 = google.oauth2({ version: 'v2', auth });
      const { data } = await oauth2.userinfo.get();
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/auth/google/refresh", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens) {
      return res.status(401).json({ error: "Nenhum token fornecido", reauth: true });
    }
    if (!tokens.refresh_token) {
      return res.status(401).json({ error: "Nenhum refresh token disponível", reauth: true });
    }
    try {
      const auth = getOAuth2Client(req.headers.host);
      auth.setCredentials(tokens);
      const refreshResult = await auth.refreshAccessToken();
      const credentials = refreshResult.credentials || refreshResult;
      const mergedTokens = { ...tokens, ...credentials };
      inMemoryGoogleTokens = mergedTokens;
      res.cookie("google_tokens", JSON.stringify(mergedTokens), {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      return res.json({ success: true, tokens: mergedTokens });
    } catch (e: any) {
      console.error("[OAuth] Erro ao renovar token de acesso:", e);
      return res.status(401).json({ error: "Sessão expirada. Reautenticação necessária.", reauth: true });
    }
  });

  const isInsufficientPermissionError = (error: any) => {
    if (!error) return false;
    if (isApiDisabledError(error)) return false;
    const message = (error.message || "").toLowerCase();
    const data = error.response?.data;
    const dataStr = typeof data === 'object' ? JSON.stringify(data).toLowerCase() : String(data || "").toLowerCase();
    
    return error.code === 403 || 
           error.status === 403 || 
           error.response?.status === 403 ||
           message.includes("insufficient permission") || 
           dataStr.includes("insufficient permission") ||
           message.includes("insufficient scope") ||
           dataStr.includes("insufficient scope") ||
           message.includes("insufficient authentication scopes") ||
           dataStr.includes("insufficient authentication scopes");
  };

  app.post("/api/auth/google/store-tokens", (req, res) => {
    const { tokens } = req.body;
    if (tokens) {
      inMemoryGoogleTokens = tokens;
      try {
        res.cookie("google_tokens", JSON.stringify(tokens), {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
      } catch (e) {}
      return res.json({ success: true, message: "Tokens armazenados com sucesso" });
    }
    res.status(400).json({ error: "Nenhum token fornecido" });
  });

  app.get("/api/auth/google/callback", async (req, res) => {
    const { code, error: authQueryError, error_description } = req.query;

    if (authQueryError) {
      console.warn(`[OAuth Callback] Google returned error: ${authQueryError} - ${error_description}`);
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Erro de Autenticação</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; }
              .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); max-width: 440px; width: 90%; }
              .error-icon { width: 44px; height: 44px; background: #fee2e2; color: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem; font-size: 20px; font-weight: bold; }
              button { background: #4f46e5; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="error-icon">✕</div>
              <h2 style="margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700; color: #991b1b;">Não foi possível concluir a autenticação</h2>
              <p style="color: #64748b; font-size: 0.875rem; line-height: 1.5; margin: 0 0 1rem;">
                ${error_description || "A autorização foi cancelada ou recusada pelo Google. Se você estiver usando autenticação em 2 etapas, certifique-se de autorizar os acessos solicitados."}
              </p>
              <button onclick="window.close()">Fechar janela e tentar novamente</button>
            </div>
          </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send("Código de autorização não encontrado.");
    }

    try {
      // Candidate redirect URIs in order of priority
      const candidateHosts = [
        req.headers.host,
        process.env.APP_URL ? new URL(process.env.APP_URL).host : null,
        "ais-dev-mnko3fredg5cl6fz5xbf3b-366038558643.us-east1.run.app",
        "ais-pre-mnko3fredg5cl6fz5xbf3b-366038558643.us-east1.run.app"
      ].filter(Boolean) as string[];

      const uniqueCandidateHosts = Array.from(new Set(candidateHosts));

      let tokens: any = null;
      let lastError: any = null;

      for (const host of uniqueCandidateHosts) {
        try {
          const client = getOAuth2Client(host);
          const exchangeResult = await client.getToken(code as string);
          if (exchangeResult?.tokens) {
            tokens = exchangeResult.tokens;
            console.log(`[OAuth Callback] Sucesso ao trocar token usando host: ${host}`);
            break;
          }
        } catch (err: any) {
          lastError = err;
          const msg = (err.message || "").toLowerCase();
          if (!msg.includes("redirect_uri_mismatch")) {
            // If it is invalid_grant (e.g. code already used or expired), breaking early
            break;
          }
        }
      }

      if (!tokens) {
        throw lastError || new Error("Falha ao obter tokens de autenticação.");
      }
      
      // Merge with existing tokens to stay robust and not lose refresh token
      let mergedTokens = tokens;
      const existingTokens = extractGoogleTokens(req);
      if (existingTokens) {
        mergedTokens = { ...existingTokens, ...tokens };
      }
      inMemoryGoogleTokens = mergedTokens;

      // Store tokens in cookie if supported
      try {
        res.cookie("google_tokens", JSON.stringify(mergedTokens), {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      } catch (e) {}

      const tokensJson = JSON.stringify(mergedTokens).replace(/</g, '\\u003c');

      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Autenticação Google Concluída</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; }
              .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); max-width: 400px; width: 90%; }
              .spinner { width: 36px; height: 36px; border: 3px solid #e2e8f0; border-top-color: #4f46e5; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1.25rem; }
              @keyframes spin { to { transform: rotate(360deg); } }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="spinner"></div>
              <h2 style="margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700;">Autenticado com sucesso!</h2>
              <p style="color: #64748b; font-size: 0.875rem; margin: 0 0 1rem;">Sincronizando com a aplicação...</p>
              <button onclick="window.close()" style="background: #4f46e5; color: white; border: none; padding: 0.5rem 1rem; border-radius: 0.5rem; font-size: 0.875rem; cursor: pointer;">Fechar esta janela</button>
            </div>
            <script>
              const tokens = ${tokensJson};
              try {
                localStorage.setItem('rj_google_tokens', JSON.stringify(tokens));
                localStorage.setItem('rj_auth_timestamp', Date.now().toString());
              } catch (e) {}

              // Notify opener window if available
              if (window.opener && !window.opener.closed) {
                try {
                  window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: tokens }, '*');
                } catch (e) {}
                setTimeout(() => {
                  try { window.close(); } catch(e) {}
                }, 1200);
              } else {
                setTimeout(() => {
                  window.location.href = '/';
                }, 1500);
              }
            </script>
          </body>
        </html>
      `);
    } catch (error: any) {
      console.error("[OAuth Callback Error]:", error);
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Erro de Troca de Credenciais</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; }
              .card { background: white; padding: 2rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); max-width: 440px; width: 90%; }
              .error-icon { width: 44px; height: 44px; background: #fee2e2; color: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem; font-size: 20px; font-weight: bold; }
              button { background: #4f46e5; color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 0.5rem; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 1rem; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="error-icon">✕</div>
              <h2 style="margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700; color: #991b1b;">Erro ao trocar credencial</h2>
              <p style="color: #64748b; font-size: 0.875rem; line-height: 1.5; margin: 0 0 1rem;">
                O código de autenticação expirou ou já foi utilizado. Por favor, feche esta janela e tente conectar novamente.
              </p>
              <button onclick="window.close()">Fechar janela</button>
            </div>
          </body>
        </html>
      `);
    }
  });

  app.get("/api/auth/google/status", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens || !tokens.access_token) {
      return res.json({ isAuthenticated: false });
    }
    try {
      // Validate access token with Google tokeninfo
      const checkRes = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${tokens.access_token}`);
      if (checkRes.ok) {
        return res.json({ isAuthenticated: true, tokens });
      }
      
      // If token expired but refresh_token exists, try refreshing
      if (tokens.refresh_token) {
        try {
          const auth = getOAuth2Client(req.headers.host);
          auth.setCredentials(tokens);
          const refreshResult = await auth.refreshAccessToken();
          const credentials = refreshResult.credentials || refreshResult;
          const mergedTokens = { ...tokens, ...credentials };
          inMemoryGoogleTokens = mergedTokens;
          return res.json({ isAuthenticated: true, tokens: mergedTokens });
        } catch (re) {}
      }

      clearGoogleTokensCookie(res);
      return res.json({ isAuthenticated: false });
    } catch (error: any) {
      console.warn("[OAuth Status Check] Error verifying Google tokens:", error);
      clearGoogleTokensCookie(res);
      res.json({ isAuthenticated: false });
    }
  });

  app.post("/api/auth/google/logout", (req, res) => {
    clearGoogleTokensCookie(res);
    res.json({ success: true });
  });

  app.post("/api/export/sheets", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens) {
      return res.status(401).json({ error: "Não autenticado com o Google", reauth: true });
    }

    const { data, title, spreadsheetId: existingSpreadsheetId } = req.body;

    try {
      const auth = getOAuth2Client(req.headers.host);
      setCredentialsAndListen(auth, tokens, res);

      const sheets = google.sheets({ version: "v4", auth });
      
      let spreadsheetId = existingSpreadsheetId;
      let sheetTitle = "Sheet1";

      if (!spreadsheetId) {
        // Create a new spreadsheet
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: {
              title: title || `Relatório de Extração - ${new Date().toLocaleDateString()}`,
            },
          },
        });
        spreadsheetId = spreadsheet.data.spreadsheetId;
        sheetTitle = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";
      } else {
        // Get existing spreadsheet metadata
        const spreadsheet = await sheets.spreadsheets.get({
          spreadsheetId,
        });
        sheetTitle = spreadsheet.data.sheets?.[0]?.properties?.title || "Sheet1";
        
        // Clear existing data before update
        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `${sheetTitle}!A1:Z1000`,
        });
      }

      // Prepare data for sheets
      // Assuming data is an array of objects
      if (data && data.length > 0) {
        const headers = Object.keys(data[0]);
        const rows = data.map((item: any) => headers.map(header => item[header]));
        const values = [headers, ...rows];

        await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheetId!,
          range: `${sheetTitle}!A1`,
          valueInputOption: "RAW",
          requestBody: {
            values,
          },
        });
      }

      res.json({ 
        success: true, 
        spreadsheetId, 
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` 
      });
    } catch (error: any) {
      if (isGoogleAuthError(error) || isInsufficientPermissionError(error)) {
        console.warn("Google authentication error during sheets export (user needs to login again).");
        clearGoogleTokensCookie(res);
        return res.status(401).json({ 
          error: "Sessão do Google expirada ou permissões insuficientes. Por favor, faça login novamente para autorizar o acesso.",
          reauth: true 
        });
      }
      console.error("Error exporting to sheets:", error);
      if (isApiDisabledError(error)) {
        const data = error.response?.data;
        const message = data?.error?.message || error.message;
        const matchedUrl = (message.match(/https:\/\/[^\s]+/)?.[0] || "").replace(/[.,();]+$/, "");
        return res.status(403).json({ 
          error: "A API do Google Sheets não está habilitada no seu projeto do Google Cloud.",
          details: message,
          link: matchedUrl || "https://console.cloud.google.com/apis/library/sheets.googleapis.com"
        });
      }
      res.status(500).json({ error: "Erro ao exportar para o Google Sheets", details: error.message });
    }
  });

  app.post("/api/gmail/send", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens) {
      return res.status(401).json({ 
        error: "Sessão do Google expirada ou permissões insuficientes. Por favor, faça login novamente para autorizar o acesso.",
        reauth: true 
      });
    }

    const { to, subject, body, attachmentBase64, attachmentName, attachments, driveFolderUrl } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: "Campos obrigatórios ausentes: destinatário, assunto ou corpo do e-mail" });
    }

    try {
      const auth = getOAuth2Client(req.headers.host);
      setCredentialsAndListen(auth, tokens, res);

      const gmail = google.gmail({ version: "v1", auth });

      const mergedAttachments = [...(attachments || [])];

      if (driveFolderUrl) {
        try {
          const drive = google.drive({ version: "v3", auth });
          const match = driveFolderUrl.match(/\/folders\/([a-zA-Z0-9-_]+)/) || driveFolderUrl.match(/[?&]id=([a-zA-Z0-9-_]+)/);
          const folderId = match ? match[1] : null;
          if (folderId) {
            logDebug(`[Gmail Send] Carregando arquivos da pasta do Drive folderId=${folderId}`);
            const filesRes = await drive.files.list({
              q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
              fields: "files(id, name, mimeType)",
            });
            const files = filesRes.data.files || [];
            logDebug(`[Gmail Send] Encontrados ${files.length} arquivos na pasta do Drive`);
            for (const file of files) {
              if (file.id && file.name) {
                logDebug(`[Gmail Send] Baixando conteúdo do arquivo do Drive: ${file.name}`);
                const fileContentRes = await drive.files.get({
                  fileId: file.id,
                  alt: "media"
                }, { responseType: "arraybuffer" });
                
                const buffer = Buffer.from(fileContentRes.data as ArrayBuffer);
                mergedAttachments.push({
                  filename: file.name,
                  content: buffer.toString("base64"),
                  contentType: file.mimeType || "application/octet-stream"
                });
              }
            }
          }
        } catch (driveErr: any) {
          console.error("[Gmail Send] Erro de download automático ao obter arquivos do Drive para o e-mail:", driveErr);
        }
      }

      let rawMessage = "";

      if ((attachmentBase64 && attachmentName) || (mergedAttachments.length > 0)) {
        const boundary = "proposta_boundary_marker_" + Date.now();
        const header = [
          `To: ${to}`,
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
          "MIME-Version: 1.0",
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          "",
        ].join("\r\n");

        const bodyPart = [
          `--${boundary}`,
          'Content-Type: text/plain; charset="utf-8"',
          "Content-Transfer-Encoding: 7bit",
          "",
          body,
          "",
        ].join("\r\n");

        const parts: string[] = [header, bodyPart];

        if (attachmentBase64 && attachmentName) {
          const attachmentPart = [
            `--${boundary}`,
            `Content-Type: application/pdf; name="${attachmentName}"`,
            `Content-Disposition: attachment; filename="${attachmentName}"`,
            "Content-Transfer-Encoding: base64",
            "",
            attachmentBase64.replace(/\s/g, ""), // strip whitespaces from base64 string
            "",
          ].join("\r\n");
          parts.push(attachmentPart);
        }

        if (mergedAttachments.length > 0) {
          for (const item of mergedAttachments) {
            if (item.content && item.filename) {
              const contentType = item.contentType || "application/octet-stream";
              const attachmentPart = [
                `--${boundary}`,
                `Content-Type: ${contentType}; name="${item.filename}"`,
                `Content-Disposition: attachment; filename="${item.filename}"`,
                "Content-Transfer-Encoding: base64",
                "",
                item.content.replace(/\s/g, ""), // strip whitespaces
                "",
              ].join("\r\n");
              parts.push(attachmentPart);
            }
          }
        }

        const footer = `--${boundary}--`;
        parts.push(footer);

        const fullMessage = parts.join("\r\n");
        rawMessage = Buffer.from(fullMessage)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      } else {
        const header = [
          `To: ${to}`,
          `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="utf-8"',
          "Content-Transfer-Encoding: 7bit",
          "",
          body,
        ].join("\r\n");
        rawMessage = Buffer.from(header)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      }

      await gmail.users.messages.send({
        userId: "me",
        requestBody: {
          raw: rawMessage,
        },
      });

      res.json({ success: true });
    } catch (error: any) {
      if (isGoogleAuthError(error) || isInsufficientPermissionError(error)) {
        console.warn("Google authentication error during Gmail send (user needs to login again).");
        clearGoogleTokensCookie(res);
        return res.status(401).json({ 
          error: "Sessão do Google expirada ou permissões insuficientes. Por favor, faça login novamente para autorizar o acesso.",
          reauth: true 
        });
      }
      console.error("Error sending email via Gmail:", error);
      if (isApiDisabledError(error)) {
        const data = error.response?.data;
        const message = data?.error?.message || error.message;
        const matchedUrl = (message.match(/https:\/\/[^\s]+/)?.[0] || "").replace(/[.,();]+$/, "");
        return res.status(403).json({ 
          error: "A API do Gmail não está habilitada no seu projeto do Google Cloud.",
          details: message,
          link: matchedUrl || "https://console.cloud.google.com/apis/library/gmail.googleapis.com"
        });
      }
      res.status(500).json({ error: "Erro ao enviar e-mail via Gmail", details: error.message });
    }
  });

  app.post("/api/drive/upload", upload.single("file"), async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens) {
      return res.status(401).json({ error: "Não autenticado com o Google", reauth: true });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Nenhum arquivo enviado" });
    }

    const { folderName, parentFolderName = process.env.DRIVE_PARENT_FOLDER || "RJ_Propostas", customFileName } = req.body;

    console.log(`[Drive] Iniciando upload de arquivo: ${req.file.originalname}. Folder: ${folderName}, Parent: ${parentFolderName}`);

    try {
      const auth = getOAuth2Client(req.headers.host);
      setCredentialsAndListen(auth, tokens, res);

      const drive = google.drive({ version: "v3", auth });

      const getOrCreateFolder = async (name: string, parentId?: string) => {
        const escapedName = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        let query = `name = '${escapedName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        
        // If searching for the top-level parent, restrict to root to avoid duplicates elsewhere
        if (!parentId) {
          query += " and 'root' in parents";
        } else {
          query += ` and '${parentId}' in parents`;
        }
        
        console.log(`[Drive] Searching for folder: "${name}" (parentId: ${parentId || 'root'})`);
        const res = await drive.files.list({
          q: query,
          fields: "files(id, name)",
          spaces: 'drive',
          pageSize: 1
        });

        if (res.data.files && res.data.files.length > 0) {
          console.log(`[Drive] Folder found: ${res.data.files[0].id}`);
          return res.data.files[0].id;
        }

        console.log(`[Drive] Folder not found, creating: "${name}"`);
        const createRes = await drive.files.create({
          requestBody: {
            name: name,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : undefined,
          },
          fields: "id",
        });
        console.log(`[Drive] Folder created: ${createRes.data.id}`);
        return createRes.data.id;
      };

      let finalParentId: string | undefined;

      // 1. Get or create the main parent folder (e.g., RJ_Propostas)
      if (parentFolderName) {
        finalParentId = await getOrCreateFolder(parentFolderName);
      }

      // 2. Get or create the subfolder (e.g., ID_EMPREENDIMENTO_UNIDADE_TORRE)
      if (folderName) {
        finalParentId = await getOrCreateFolder(folderName, finalParentId);
      }

      const fileMetadata: any = {
        name: customFileName ? `${customFileName} - ${req.file.originalname}` : req.file.originalname,
      };

      if (finalParentId) {
        fileMetadata.parents = [finalParentId];
      }

      const media = {
        mimeType: req.file.mimetype,
        body: Readable.from(req.file.buffer),
      };

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: media,
        fields: "id, name, webViewLink",
      });

      res.json({
        success: true,
        fileId: response.data.id,
        fileName: response.data.name,
        fileUrl: response.data.webViewLink,
        folderUrl: finalParentId ? `https://drive.google.com/drive/folders/${finalParentId}` : undefined,
      });
    } catch (error: any) {
      if (isGoogleAuthError(error) || isInsufficientPermissionError(error)) {
        console.warn("Google authentication error during Drive upload (user needs to login again).");
        clearGoogleTokensCookie(res);
        return res.status(401).json({ 
          error: "Sessão do Google expirada ou permissões insuficientes. Por favor, faça login novamente para autorizar o acesso.",
          reauth: true
        });
      }
      console.error("Error uploading to Drive:", error);
      if (isApiDisabledError(error)) {
        const data = error.response?.data;
        const message = data?.error?.message || error.message;
        const matchedUrl = (message.match(/https:\/\/[^\s]+/)?.[0] || "").replace(/[.,();]+$/, "");
        return res.status(403).json({ 
          error: "A API do Google Drive não está habilitada no seu projeto do Google Cloud.",
          details: message,
          link: matchedUrl || "https://console.cloud.google.com/apis/library/drive.googleapis.com"
        });
      }
      res.status(500).json({ error: "Erro ao fazer upload para o Google Drive", details: error.message });
    }
  });

  app.get("/api/drive/list", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens) {
      return res.status(401).json({ error: "Não autenticado com o Google", reauth: true });
    }

    const { folderName = "RJ_Propostas" } = req.query;

    try {
      const auth = getOAuth2Client(req.headers.host);
      setCredentialsAndListen(auth, tokens, res);
      const drive = google.drive({ version: "v3", auth });

      // Find folder ID
      const folderRes = await drive.files.list({
        q: `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: "files(id)",
        pageSize: 1
      });

      let folderId = "";
      if (folderRes.data.files && folderRes.data.files.length > 0) {
        folderId = folderRes.data.files[0].id!;
      } else {
        return res.json({ files: [], folderCreated: false });
      }

      // List files in folder
      const filesRes = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: "files(id, name, mimeType, webViewLink, createdTime, thumbnailLink)",
        orderBy: "createdTime desc",
      });

      res.json({ 
        files: filesRes.data.files || [], 
        folderId,
        folderName 
      });
    } catch (error: any) {
      if (isGoogleAuthError(error) || isInsufficientPermissionError(error)) {
        console.warn("Google authentication error during Drive list (user needs to login again).");
        clearGoogleTokensCookie(res);
        return res.status(401).json({ 
          error: "Sessão do Google expirada ou permissões insuficientes. Por favor, faça login novamente.",
          reauth: true
        });
      }
      console.error("Error listing Drive files:", error);
      res.status(500).json({ error: "Erro ao listar arquivos do Drive", details: error.message });
    }
  });

  app.get("/api/drive/file/:fileId", async (req, res) => {
    const tokens = extractGoogleTokens(req);
    if (!tokens) {
      logDebug("[Drive Route Error] No google_tokens found in request headers, cookies or memory");
      return res.status(401).send("Unauthorized");
    }

    const { fileId } = req.params;

    try {
      logDebug(`[Drive Route] Início de download do arquivo id=${fileId}`);
      const auth = getOAuth2Client(req.headers.host);
      setCredentialsAndListen(auth, tokens, res);
      const drive = google.drive({ version: "v3", auth });

      // Fetch metadata to get the name and exact mimeType and size
      const metadata = await drive.files.get({ fileId, fields: "mimeType, name, size" });
      const mimeType = metadata.data.mimeType || "application/octet-stream";
      const fileName = metadata.data.name || "file";
      const fileSize = metadata.data.size;

      logDebug(`[Drive Route] Meta obtida: fileName="${fileName}", mimeType="${mimeType}", fileSize=${fileSize}`);

      let fileBuffer: Buffer;
      let finalMimeType = mimeType;

      const googleWorkspaceMimeTypes = [
        "application/vnd.google-apps.document",
        "application/vnd.google-apps.spreadsheet",
        "application/vnd.google-apps.presentation"
      ];

      if (googleWorkspaceMimeTypes.includes(mimeType)) {
        logDebug(`[Drive Route] Exportando formato Google Workspace como PDF usando stream...`);
        finalMimeType = "application/pdf";
        const exportRes = await drive.files.export(
          { fileId, mimeType: "application/pdf" },
          { responseType: "stream" }
        );
        if (!exportRes.data) {
          throw new Error("exportRes.data retornou vazio ao exportar do Drive");
        }
        fileBuffer = await responseToBuffer(exportRes.data);
      } else {
        logDebug(`[Drive Route] Baixando arquivo binário padrão usando stream...`);
        const fileRes = await drive.files.get(
          { fileId, alt: "media" },
          { responseType: "stream" }
        );
        if (!fileRes.data) {
          throw new Error("fileRes.data retornou vazio ao baixar do Drive");
        }
        fileBuffer = await responseToBuffer(fileRes.data);
      }

      logDebug(`[Drive Route] Arquivo baixado com sucesso. Buffer final: ${fileBuffer.length} bytes`);

      if (fileBuffer.length === 0) {
        throw new Error("O arquivo baixado do Google Drive está vazio (0 bytes).");
      }

      // Log the first 100 bytes is incredibly useful for diagnosing corruption
      const previewBytes = fileBuffer.slice(0, 100);
      logDebug(`[Drive Route] Primeiros 100 bytes (Hex): ${previewBytes.toString("hex")}`);
      logDebug(`[Drive Route] Primeiros 100 bytes (ASCII/UTF8, filtrando binário): ${previewBytes.toString("utf8").replace(/[^\x20-\x7E]/g, ".")}`);

      res.setHeader("Content-Type", finalMimeType);
      res.setHeader("Content-Length", fileBuffer.length);
      
      const finalFileName = googleWorkspaceMimeTypes.includes(mimeType) 
        ? (fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`)
        : fileName;
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(finalFileName)}"`);
      
      res.send(fileBuffer);
    } catch (error: any) {
      logDebug(`[Drive Route Error] Falha de download do arquivo ${fileId}: ${error.message}`);
      if (isGoogleAuthError(error) || isInsufficientPermissionError(error)) {
        console.warn(`Google authentication error fetching file content for ${fileId} (user needs to login again).`);
        clearGoogleTokensCookie(res);
        return res.status(401).json({ 
          error: "Sessão do Google expirada ou permissões insuficientes. Por favor, faça login novamente.",
          reauth: true
        });
      }
      console.error("Error fetching file content:", error);
      res.status(500).json({ error: "Erro ao buscar conteúdo do arquivo", details: error.message });
    }
  });

  // Cache of models that have hit daily free-tier quota limits (429 RESOURCE_EXHAUSTED)
  const quotaExhaustedModels = new Map<string, number>();

  app.post("/api/gemini/extract", async (req, res) => {
    try {
      const { parts, model, responseSchema } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;

      if (!apiKey) {
        logDebug("[Gemini Extract Error] API Key missing in environment");
        console.error("[Gemini Server] API Key missing in environment (process.env.GEMINI_API_KEY).");
        return res.status(500).json({ 
          error: "A chave API Gemini não foi encontrada nas variáveis de ambiente do servidor. Verifique as configurações de secrets." 
        });
      }

      // Cleanup expired quota-exhausted models
      const now = Date.now();
      for (const [m, expiry] of quotaExhaustedModels.entries()) {
        if (now > expiry) {
          quotaExhaustedModels.delete(m);
        }
      }

      // Calculate total payload size to dynamically grant sufficient timeout to multi-megabyte PDFs
      let payloadChars = 0;
      if (parts && Array.isArray(parts)) {
        parts.forEach((p: any) => {
          payloadChars += (p?.inlineData?.data?.length || 0) + (p?.text?.length || 0);
        });
      }
      const isHeavyPayload = payloadChars > 1500000; // > 1.5MB base64

      logDebug(`[Gemini Extract] Iniciando processamento com o modelo: ${model || "default"}, Parts count: ${parts?.length || 0}, Payload size: ${(payloadChars / 1024 / 1024).toFixed(2)} MB`);
      
      if (parts && Array.isArray(parts)) {
        parts.forEach((p: any, idx: number) => {
          if (p.inlineData) {
            const dataLen = p.inlineData.data ? p.inlineData.data.length : 0;
            logDebug(`[Gemini Extract] Part[${idx}]: InlineData mimeType="${p.inlineData.mimeType}", data length = ${dataLen} characters (Base64)`);
            if (dataLen > 100) {
              const headBase64 = p.inlineData.data.substring(0, 40);
              logDebug(`[Gemini Extract] Part[${idx}]: Inicio do base64: "${headBase64}"`);
            }
          } else if (p.text) {
            logDebug(`[Gemini Extract] Part[${idx}]: Text segment (prompt) length = ${p.text.length}`);
          } else {
            logDebug(`[Gemini Extract] Part[${idx}]: Unknown style part`);
          }
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Ordered list of candidate models: prioritize rock-solid stability and high availability
      const defaultCandidateModels = [
        "gemini-3.8-flash",
        "gemini-2.5-flash",
        "gemini-3.1-flash-lite",
        "gemini-flash-latest"
      ];

      let requestedModel = model && typeof model === "string" ? model.trim() : "";
      // If the requested model is currently in cooldown (e.g. 503 high demand or 429 quota), clear it to use the active pool
      if (requestedModel && quotaExhaustedModels.has(requestedModel)) {
        logDebug(`[Gemini Extract] Modelo solicitado "${requestedModel}" está em cooldown temporário. Utilizando pool de modelos ativos.`);
        requestedModel = "";
      }

      // Filter candidates to bypass models that hit daily quota limits or are in 503 cooldown
      const activeCandidates = defaultCandidateModels.filter(m => !quotaExhaustedModels.has(m));
      const pool = activeCandidates.length > 0 ? activeCandidates : defaultCandidateModels;

      const candidateModels = requestedModel && !quotaExhaustedModels.has(requestedModel)
        ? [requestedModel, ...pool.filter(m => m !== requestedModel)]
        : pool;

      const isTransientError = (e: any): boolean => {
        const str = String(e?.message || e?.details || e || "").toLowerCase();
        const code = Number(e?.status || e?.code || 0);
        return (
          code === 503 ||
          code === 429 ||
          code === 504 ||
          code === 502 ||
          code === 500 ||
          str.includes("timeout") ||
          str.includes("high demand") ||
          str.includes("unavailable") ||
          str.includes("deadline_exceeded") ||
          str.includes("deadline exceeded") ||
          str.includes("timed out") ||
          str.includes("spikes in demand") ||
          str.includes("try again later") ||
          str.includes("resource has been exhausted") ||
          str.includes("overloaded") ||
          str.includes("rate limit")
        );
      };

      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Utility to abort individual model call after timeout (prevents hanging requests while giving ample time for large PDFs)
      const withTimeout = <T>(promise: Promise<T>, ms: number, modelName: string): Promise<T> => {
        let timer: NodeJS.Timeout;
        const timeoutPromise = new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Timeout de ${Math.round(ms / 1000)}s excedido na chamada do modelo ${modelName}`));
          }, ms);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
      };

      let response: any = null;
      let lastErr: any = null;
      let successfulModel = "";
      const startTime = Date.now();
      const MAX_TOTAL_DURATION_MS = 160000; // 160 seconds max overall

      for (let i = 0; i < candidateModels.length; i++) {
        const currentModel = candidateModels[i];
        
        // Skip if model was flagged as quota exhausted
        if (quotaExhaustedModels.has(currentModel)) {
          logDebug(`[Gemini Extract] Pulando modelo ${currentModel} pois está na lista de quota esgotada.`);
          continue;
        }

        // If total elapsed time is nearing gateway timeout limit, stop cascade
        if (Date.now() - startTime > MAX_TOTAL_DURATION_MS - 20000) {
          logDebug(`[Gemini Extract] Tempo total aproximando-se do limite de timeout (${Math.round((Date.now() - startTime) / 1000)}s). Interrompendo cascata.`);
          break;
        }

        logDebug(`[Gemini Extract] [Tentativa ${i + 1}/${candidateModels.length}] Testando modelo: ${currentModel}...`);

        try {
          // Dynamic timeout per model call: 70s for heavy payloads (e.g. 10MB PDFs), 35s for standard documents
          const modelTimeoutMs = isHeavyPayload ? 70000 : 35000;

          const isGemini3 = currentModel.startsWith("gemini-3");
          const isLite = currentModel.includes("lite");
          const callConfig: any = {
            responseMimeType: "application/json",
          };
          if (responseSchema) {
            callConfig.responseSchema = responseSchema;
          }
          if (isGemini3) {
            // Minimize latency while preserving extraction accuracy
            callConfig.thinkingConfig = {
              thinkingLevel: isLite ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW
            };
          } else if (currentModel.startsWith("gemini-2.5") && !isLite) {
            // Setting thinkingBudget: 0 disables excessive deliberation and yields fast JSON extraction
            callConfig.thinkingConfig = {
              thinkingBudget: 0
            };
          }

          response = await withTimeout(
            ai.models.generateContent({
              model: currentModel,
              contents: [{ role: 'user', parts }],
              config: callConfig
            }),
            modelTimeoutMs,
            currentModel
          );

          if (response && response.text) {
            successfulModel = currentModel;
            logDebug(`[Gemini Extract] SUCESSO com o modelo "${currentModel}"!`);
            break;
          } else {
            throw new Error("Resposta vazia retornada pela API Gemini");
          }
        } catch (modelErr: any) {
          lastErr = modelErr;
          const errSummary = String(modelErr?.message || modelErr?.details || modelErr).substring(0, 180);
          logDebug(`[Gemini Extract] Falha no modelo "${currentModel}": ${errSummary}`);

          const errStr = String(modelErr?.message || modelErr?.details || modelErr);
          
          // If model returned 429 quota exhaustion, mark in cache so future calls bypass it immediately
          if (
            errStr.includes("Quota exceeded") || 
            errStr.includes("RESOURCE_EXHAUSTED") ||
            (errStr.includes("429") && errStr.includes("quota"))
          ) {
            logDebug(`[Gemini Extract] Modelo "${currentModel}" atingiu limite diário de quota (429). Registrado como esgotado temporariamente.`);
            quotaExhaustedModels.set(currentModel, Date.now() + 45 * 60 * 1000); // 45 min suppression
          }

          // If it's a non-transient, permanent error (e.g. document has no pages, invalid file format, bad API key), stop cascade immediately
          if (
            errStr.includes("The document has no pages") ||
            errStr.includes("Unsupported mime type") ||
            (errStr.includes("INVALID_ARGUMENT") && (errStr.includes("mime") || errStr.includes("type"))) ||
            errStr.includes("API_KEY_INVALID") ||
            errStr.includes("API key not valid")
          ) {
            logDebug(`[Gemini Extract] Erro permanente detectado ("${errSummary}"). Interrompendo cascata de modelos.`);
            throw modelErr;
          }

          if (i < candidateModels.length - 1 && (Date.now() - startTime < MAX_TOTAL_DURATION_MS)) {
            logDebug(`[Gemini Extract] Fazendo failover imediato para o próximo modelo candidato (${candidateModels[i + 1]})...`);
            await delay(300);
          } else if (i === candidateModels.length - 1 && isTransientError(modelErr) && (Date.now() - startTime < 35000)) {
            logDebug(`[Gemini Extract] Todos os modelos enfrentaram picos de tráfego. Realizando tentativa final de recuperação com gemini-2.5-flash...`);
            await delay(1200);
            try {
              response = await withTimeout(
                ai.models.generateContent({
                  model: "gemini-2.5-flash",
                  contents: [{ role: 'user', parts }],
                  config: {
                    responseMimeType: "application/json",
                    ...(responseSchema ? { responseSchema } : {}),
                    thinkingConfig: { thinkingBudget: 0 }
                  }
                }),
                25000,
                "gemini-2.5-flash-retry"
              );
              if (response && response.text) {
                successfulModel = "gemini-2.5-flash";
                logDebug(`[Gemini Extract] Recuperação bem-sucedida com gemini-2.5-flash!`);
                break;
              }
            } catch (retryErr: any) {
              lastErr = retryErr;
              logDebug(`[Gemini Extract] Falha na tentativa final de recuperação: ${retryErr?.message || retryErr}`);
            }
          }
        }

        if (response && response.text) {
          break;
        }
      }

      if (!response || !response.text) {
        throw lastErr || new Error("Não foi possível obter resposta de nenhum dos modelos Gemini disponíveis.");
      }

      logDebug(`[Gemini Extract] Extração finalizada com êxito pelo modelo ${successfulModel}.`);
      res.json({ text: response.text, modelUsed: successfulModel });
    } catch (err: any) {
      logDebug(`[Gemini Extract Error] Erro final ao chamar a API Gemini: ${err.message || String(err)}`);
      console.error("[Gemini Server] Erro ao chamar a API Gemini:", err);
      
      let friendlyError = "Erro no processamento da API Gemini pelo servidor";
      let statusCode = 500;
      const errStr = String(err.message || err.details || err);
      
      if (errStr.includes("The document has no pages")) {
        friendlyError = "O arquivo PDF enviado parece não conter nenhuma página válida ou está em branco. Certifique-se de que o documento não esteja protegido ou corrompido.";
        statusCode = 400;
      } else if (errStr.includes("Unsupported mime type") || (errStr.includes("INVALID_ARGUMENT") && (errStr.includes("mime") || errStr.includes("type")))) {
        friendlyError = "O formato de arquivo enviado não é suportado pelo analisador de documentos. Por favor, utilize PDF ou Imagens (PNG, JPG, WEBP).";
        statusCode = 400;
      } else if (errStr.includes("Resource has been exhausted") || errStr.includes("429")) {
        friendlyError = "Limite de requisições do Gemini excedido temporariamente. Por favor, tente novamente em instantes.";
        statusCode = 429;
      } else if (errStr.includes("API_KEY_INVALID") || errStr.includes("API key not valid")) {
        friendlyError = "A chave de API do Gemini configurada é inválida ou expirou. Verifique as configurações de secrets do servidor.";
        statusCode = 401;
      } else if (
        errStr.includes("high demand") || 
        errStr.includes("503") || 
        errStr.includes("UNAVAILABLE") || 
        errStr.includes("DEADLINE_EXCEEDED") ||
        errStr.includes("Spikes in demand")
      ) {
        friendlyError = "Os servidores de inteligência artificial da Google estão temporariamente com alta demanda. Por favor, aguarde alguns instantes e tente novamente.";
        statusCode = 503;
      } else if (errStr.includes("Timeout") || errStr.includes("excedido")) {
        friendlyError = "O tempo de processamento do documento excedeu o limite. Tente enviar arquivos menores ou com menos páginas.";
        statusCode = 504;
      }
      
      res.status(statusCode).json({ 
        error: friendlyError, 
        details: err.message || String(err)
      });
    }
  });

  // Assinafy Electronic Signature API Integration Routes
  app.post("/api/assinafy/create-envelope", async (req, res) => {
    console.log("[Assinafy Endpoint] Recebeu requisição. Chaves no body:", Object.keys(req.body || {}));
    const { apiToken, documentBase64, documentName, signers, cargos, isSandbox } = req.body;
    
    console.log("[Assinafy Endpoint] documentBase64 length:", documentBase64 ? documentBase64.length : 0);
    console.log("[Assinafy Endpoint] Is signers array:", Array.isArray(signers), "length:", signers ? signers.length : 0);
    if (signers && Array.isArray(signers)) {
      console.log("[Assinafy Endpoint] Signers content:", JSON.stringify(signers));
    }

    if (!documentBase64 || !signers || !Array.isArray(signers) || signers.length === 0) {
      console.log("[Assinafy Endpoint] Erro: parâmetros obrigatórios ausentes!");
      return res.status(400).json({ error: "Parâmetros obrigatórios ausentes: documentBase64 e signers" });
    }

    // Validador e normalizador estrito de telefone celular / WhatsApp para o padrão E.164 exigido pela Assinafy (+55 DDD 9XXXXXXXX)
    const normalizeWhatsAppPhone = (phone?: string, hasEmail: boolean = false): string | undefined => {
      if (!phone) return undefined;
      let digits = String(phone).replace(/\D/g, "");
      if (!digits) return undefined;

      // Se já começar com o código do país (55)
      if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
        digits = digits.substring(2);
      }

      // Validar tamanho mínimo
      if (digits.length < 10 || digits.length > 11) {
        console.warn(`[Assinafy Validation] Telefone descartado (tamanho inválido ${digits.length}): ${phone}`);
        return undefined;
      }

      const ddd = parseInt(digits.substring(0, 2), 10);
      if (isNaN(ddd) || ddd < 11 || ddd > 99) {
        console.warn(`[Assinafy Validation] Telefone descartado (DDD inválido ${ddd}): ${phone}`);
        return undefined;
      }

      // Se tem 10 dígitos (DDD + 8 dígitos):
      if (digits.length === 10) {
        const firstNum = digits.charAt(2);
        // Se começa com 9, 8 ou 7, pode ser celular antigo sem o 9º dígito:
        if (firstNum === '9' || firstNum === '8' || firstNum === '7') {
          digits = digits.substring(0, 2) + '9' + digits.substring(2);
        } else {
          // É telefone fixo (começa com 2, 3, 4, 5). Telefones fixos NÃO suportam WhatsApp na Assinafy!
          console.warn(`[Assinafy Validation] Telefone fixo descartado (${digits}), não compatível com WhatsApp da Assinafy.`);
          return undefined;
        }
      }

      // Agora deve ter exatamente 11 dígitos e o 3º dígito deve ser '9' (celular móvel brasileiro)
      if (digits.length === 11 && digits.charAt(2) === '9') {
        const numberPart = digits.substring(2);
        // Rejeitar números de teste óbvios com dígitos repetidos (ex: 999999999, 900000000, 911111111)
        if (/^(\d)\1+$/.test(numberPart) || numberPart === '900000000' || numberPart === '912345678') {
          console.warn(`[Assinafy Validation] Telefone com sequência inválida descartado: ${digits}`);
          return undefined;
        }
        return `+55${digits}`;
      }

      console.warn(`[Assinafy Validation] Telefone celular não atende aos padrões válidos de WhatsApp: ${digits}`);
      return undefined;
    };

    // Helper no servidor para localizar cargo no cadastro de cargos recebido
    const findCargoInServer = (name?: string, cargosList: any[] = []): any | undefined => {
      if (!name || !cargosList || cargosList.length === 0) return undefined;
      const n = String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      if (!n) return undefined;
      return cargosList.find(c => {
        const cn = (c.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const ca = (c.apelido || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const cc = (c.cargo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const ce = (c.email || '').toLowerCase().trim();
        return cn === n || cn.includes(n) || n.includes(cn) || ca === n || cc === n || (n.includes('samuel') && cn.includes('samuel')) || ce === n;
      });
    };

    // Filtrar e enriquecer signatários garantindo que dados e e-mails de testemunhas sejam estritamente idênticos ao cadastro de cargos
    const validSigners = (signers || []).map((s: any, idx: number) => {
      if (!s || !s.name || !String(s.name).trim()) return null;
      let name = String(s.name).trim();
      let email = s.email ? String(s.email).trim() : '';
      let phone = s.phone || s.whatsapp_phone_number || '';
      let cpf = s.cpf || '';
      const isWitness = (s.role || '').toLowerCase().includes('testemunha') || name.toLowerCase().includes('testemunha');

      // Buscar correspondência direta no cadastro de cargos
      let match = findCargoInServer(name, cargos);
      // Somente se for um placeholder genérico sem e-mail ("testemunha", "testemunha 1", etc.) e não houver correspondência, busca testemunha padrão do cadastro
      if (!match && isWitness && !email && (name.toLowerCase() === 'testemunha' || name.toLowerCase() === 'testemunha 1' || name.toLowerCase() === 'testemunha 2')) {
        const witnessCargos = (cargos || []).filter((c: any) => 
          (c.cargo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().includes('testemunha') ||
          (c.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().includes('samuel') ||
          (c.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().includes('cerqueira')
        );
        const samuelCargo = findCargoInServer('SAMUEL CERQUEIRA', cargos);
        const w1 = samuelCargo || witnessCargos[0];
        const firstWitnessIdx = signers.findIndex((item: any) => (item.role || '').toLowerCase().includes('testemunha'));
        const isFirst = idx === firstWitnessIdx || name.toLowerCase().includes('1');
        if (isFirst) {
          match = w1;
        } else {
          match = witnessCargos.find((w: any) => w !== w1) || (cargos || []).find((c: any) => c !== w1 && Boolean(c.email && c.email.trim()));
        }
      }

      if (match) {
        // O e-mail DEVE ser ESTRITAMENTE IDÊNTICO ao do cadastro de cargos
        if (match.email && match.email.trim()) {
          email = match.email.trim();
        }
        if (match.nome && (!name || name.toLowerCase().includes('testemunha'))) {
          name = match.nome.trim();
        }
        if (!cpf && match.cpf_cnpj) cpf = match.cpf_cnpj.trim();
        if (!phone && match.telefone) phone = match.telefone.trim();
      }

      const hasEmail = Boolean(email && email.trim());
      const hasPhone = Boolean(normalizeWhatsAppPhone(phone, hasEmail));
      if (!hasEmail && !hasPhone) {
        console.warn(`[Assinafy Validation] Signatário "${name}" sem e-mail/WhatsApp válido e desconsiderado.`);
        return null;
      }

      return {
        ...s,
        name,
        email,
        phone,
        cpf
      };
    }).filter(Boolean);

    // Garantir que as duas testemunhas constem obrigatoriamente
    const currentWitnesses = validSigners.filter((s: any) => {
      return (s.role || '').toLowerCase().includes('testemunha') || String(s.name || '').toLowerCase().includes('testemunha');
    });

    if (currentWitnesses.length === 0) {
      const samuelCargo = findCargoInServer('SAMUEL CERQUEIRA', cargos);
      const witnessCargos = (cargos || []).filter((c: any) => (c.cargo || '').toLowerCase().includes('testemunha'));
      const w1 = samuelCargo || witnessCargos[0];
      const w2 = witnessCargos.find((w: any) => w !== w1) || (cargos || []).find((c: any) => c !== w1 && Boolean(c.email && c.email.trim()));

      if (w1 && w1.email) {
        validSigners.push({
          name: w1.nome ? w1.nome.trim() : 'SAMUEL CERQUEIRA',
          email: w1.email.trim(),
          cpf: w1.cpf_cnpj || '',
          phone: w1.telefone || '',
          role: 'Testemunha'
        });
      }
      if (w2 && w2.email) {
        validSigners.push({
          name: w2.nome ? w2.nome.trim() : 'Testemunha 2',
          email: w2.email.trim(),
          cpf: w2.cpf_cnpj || '',
          phone: w2.telefone || '',
          role: 'Testemunha'
        });
      }
      console.log(`[Assinafy Validation] As 2 testemunhas do cadastro de cargos foram adicionadas ao envelope.`);
    } else if (currentWitnesses.length === 1) {
      const firstWitness = currentWitnesses[0];
      const witnessCargos = (cargos || []).filter((c: any) => (c.cargo || '').toLowerCase().includes('testemunha'));
      const w2 = witnessCargos.find((w: any) => (w.email || '').toLowerCase().trim() !== (firstWitness.email || '').toLowerCase().trim() && (w.nome || '').toLowerCase().trim() !== (firstWitness.name || '').toLowerCase().trim()) ||
                 (cargos || []).find((c: any) => (c.email || '').toLowerCase().trim() !== (firstWitness.email || '').toLowerCase().trim() && Boolean(c.email && c.email.trim()));
      if (w2 && w2.email) {
        validSigners.push({
          name: w2.nome ? w2.nome.trim() : 'Testemunha 2',
          email: w2.email.trim(),
          cpf: w2.cpf_cnpj || '',
          phone: w2.telefone || '',
          role: 'Testemunha'
        });
        console.log(`[Assinafy Validation] Segunda testemunha do cadastro de cargos ("${w2.nome}") adicionada ao envelope com e-mail ${w2.email}.`);
      }
    }

    if (validSigners.length === 0) {
      return res.status(400).json({
        error: "Nenhum signatário válido com e-mail ou WhatsApp informado. Adicione ao menos um e-mail para envio do contrato."
      });
    }

    // Deduplicação estrita de signatários para evitar o erro "Existem signatários duplicados." da API Assinafy
    const uniqueSigners: any[] = [];
    const seenEmails = new Set<string>();
    const seenCpfs = new Set<string>();
    const seenPhones = new Set<string>();
    const seenNames = new Set<string>();

    for (const s of validSigners) {
      let email = s.email && String(s.email).trim() ? String(s.email).trim().toLowerCase() : undefined;
      const rawCpf = s.cpf ? String(s.cpf).replace(/\D/g, "") : undefined;
      let cpf = rawCpf && rawCpf.length >= 11 ? rawCpf : undefined;
      let phone = normalizeWhatsAppPhone(s.phone || s.whatsapp_phone_number, Boolean(email));
      let name = s.name ? String(s.name).trim() : "";
      const isWitness = (s.role || '').toLowerCase().includes('testemunha') || name.toLowerCase().includes('testemunha');
      const nameKey = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      // Se for testemunha, nunca descartar por colisão de e-mail/CPF/Telefone: aplicar aliasing de e-mail e desvincular CPF redundante
      if (isWitness) {
        if (cpf && seenCpfs.has(cpf)) {
          cpf = undefined;
        }
        if (phone && seenPhones.has(phone)) {
          phone = undefined;
        }
        if (email && seenEmails.has(email)) {
          const parts = email.split('@');
          if (parts.length === 2) {
            const baseUser = parts[0].split('+')[0];
            const domain = parts[1];
            const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'testemunha';
            let candidate = `${baseUser}+${cleanName}@${domain}`;
            let count = 2;
            while (seenEmails.has(candidate)) {
              candidate = `${baseUser}+${cleanName}${count}@${domain}`;
              count++;
            }
            email = candidate;
          }
        }
      }

      let isDuplicate = false;
      let matchedIndex = -1;

      // 1. Checar duplicação apenas se não for testemunha (ou se a testemunha não puder ser diferenciada)
      if (!isWitness) {
        if (email && seenEmails.has(email)) {
          isDuplicate = true;
          matchedIndex = uniqueSigners.findIndex(u => (u.email || '').toLowerCase().trim() === email);
        } else if (cpf && seenCpfs.has(cpf)) {
          isDuplicate = true;
          matchedIndex = uniqueSigners.findIndex(u => (u.cpf || '').replace(/\D/g, '') === cpf);
        } else if (phone && seenPhones.has(phone)) {
          isDuplicate = true;
          matchedIndex = uniqueSigners.findIndex(u => {
            const uPhone = normalizeWhatsAppPhone(u.phone || u.whatsapp_phone_number, Boolean(u.email));
            return uPhone === phone;
          });
        } else if (nameKey && seenNames.has(nameKey)) {
          isDuplicate = true;
          matchedIndex = uniqueSigners.findIndex(u => {
            const uNameKey = String(u.name || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            return uNameKey === nameKey;
          });
        }
      }

      if (isDuplicate) {
        console.warn(`[Assinafy Deduplication] Signatário duplicado detectado e mesclado: "${name}" (Email: ${email}, CPF: ${cpf}, Phone: ${phone})`);
        if (matchedIndex !== -1) {
          const target = uniqueSigners[matchedIndex];
          if (!target.cpf && cpf) target.cpf = cpf;
          if (!target.phone && phone) target.phone = phone;
          if (!target.email && email) target.email = email;
          if (s.role && target.role && !target.role.includes(s.role)) {
            target.role = `${target.role} / ${s.role}`;
          }
        }
      } else {
        if (email) seenEmails.add(email);
        if (cpf) seenCpfs.add(cpf);
        if (phone) seenPhones.add(phone);
        if (nameKey) seenNames.add(nameKey);
        uniqueSigners.push({
          ...s,
          name,
          email,
          cpf,
          phone
        });
      }
    }

    if (uniqueSigners.length === 0) {
      return res.status(400).json({
        error: "Nenhum signatário válido restante após a consolidação de signatários."
      });
    }

    // Verificar se algum dos signatários participantes restantes está sem contato válido (e-mail ou whatsapp válido)
    const signersWithoutContact = uniqueSigners.filter((s: any) => {
      const email = s.email && String(s.email).trim();
      const phone = normalizeWhatsAppPhone(s.phone || s.whatsapp_phone_number, Boolean(email));
      return !email && !phone;
    });

    if (signersWithoutContact.length > 0) {
      const names = signersWithoutContact.map((s: any) => s.name).join(", ");
      return res.status(400).json({
        error: `O(s) signatário(s) [${names}] precisa(m) de um e-mail válido ou de um número de celular com WhatsApp válido (ex: (21) 98888-7777) para receber o documento para assinatura.`
      });
    }

    // Sandbox / Simulation Mode
    if (isSandbox || !apiToken) {
      console.log("[Assinafy Endpoint] Executando em modo Sandbox de Simulação com", uniqueSigners.length, "signatários únicos.");
      const envelopeId = "env_" + Math.random().toString(36).substring(2, 12);
      const simulatedSigners = uniqueSigners.map((s: any, idx: number) => ({
        ...s,
        id: `sig_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        status: "Pendente",
        signUrl: `https://app.assinafy.com.br/sign/${envelopeId}/${idx}`
      }));

      return res.json({
        success: true,
        isSandbox: true,
        envelopeId,
        documentName,
        status: "Pendente",
        signers: simulatedSigners,
        viewUrl: `https://app.assinafy.com.br/envelopes/${envelopeId}`,
        created_at: new Date().toISOString()
      });
    }

    try {
      console.log(`[Assinafy API] Iniciando envio real de envelope usando o SDK oficial: "${documentName}" com ${uniqueSigners.length} signatários únicos...`);
      
      const clientOptions: any = {};
      const tokenStr = String(apiToken).trim();
      if (tokenStr.startsWith("k_")) {
        clientOptions.apiKey = tokenStr;
      } else {
        clientOptions.token = tokenStr;
      }

      const client = new AssinafyClient(clientOptions);

      // Listar workspaces do usuário para encontrar o account_id correto automaticamente
      console.log("[Assinafy API] Buscando workspaces/contas associadas ao token...");
      const workspacesResult = await client.workspaces.list();
      const workspaces = workspacesResult.data;
      if (!workspaces || workspaces.length === 0) {
        throw new Error("Nenhuma conta ou workspace encontrada para esta credencial do Assinafy. Verifique seu token de acesso.");
      }
      const accountId = workspaces[0].id;
      console.log(`[Assinafy API] Usando accountId: ${accountId} (Nome: ${workspaces[0].name || 'Padrão'})`);

      // Sanitizar nome do documento garantindo extensão .pdf
      let safeDocName = (documentName && String(documentName).trim()) || "Contrato_Corretagem.pdf";
      safeDocName = safeDocName.replace(/[^a-zA-Z0-9._-]/g, "_");
      if (!safeDocName.toLowerCase().endsWith(".pdf")) {
        safeDocName += ".pdf";
      }

      // Converter o base64 para Buffer limpando eventuais prefixos data URI
      const rawPdfBase64 = String(documentBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
      const buffer = Buffer.from(rawPdfBase64, "base64");

      // Preparar signatários finais com garantia absoluta de unicidade (Zero duplicatas na Assinafy)
      const finalSignersForAssinafy: Array<{
        name: string;
        email?: string;
        whatsapp_phone_number?: string;
        cpf?: string;
        metadata: { role: string };
      }> = [];

      const usedEmails = new Set<string>();
      const usedPhones = new Set<string>();
      const usedCpfs = new Set<string>();
      const usedNames = new Set<string>();

      for (let i = 0; i < uniqueSigners.length; i++) {
        const s = uniqueSigners[i];
        let name = s.name ? String(s.name).trim() : `Signatário ${i + 1}`;
        let email = s.email && String(s.email).trim() ? String(s.email).trim().toLowerCase() : undefined;
        let cpf = s.cpf ? String(s.cpf).replace(/\D/g, '') : undefined;
        if (cpf && cpf.length < 11) cpf = undefined;
        let phone = normalizeWhatsAppPhone(s.phone || s.whatsapp_phone_number, Boolean(email));

        const isWitness = (s.role || '').toLowerCase().includes('testemunha') || name.toLowerCase().includes('testemunha');

        // 1. Unicidade de E-mail
        if (email && usedEmails.has(email)) {
          if (isWitness) {
            const parts = email.split('@');
            if (parts.length === 2) {
              const baseUser = parts[0].split('+')[0];
              const domain = parts[1];
              const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'testemunha';
              let candidate = `${baseUser}+${cleanName}@${domain}`;
              let count = 2;
              while (usedEmails.has(candidate)) {
                candidate = `${baseUser}+${cleanName}${count}@${domain}`;
                count++;
              }
              email = candidate;
              console.log(`[Assinafy Guard] E-mail duplicado para testemunha. Aliasing aplicado: "${email}"`);
            }
          } else {
            console.warn(`[Assinafy Guard] E-mail já utilizado: "${email}" para "${name}". Mesclando ao signatário existente.`);
            const existing = finalSignersForAssinafy.find(f => f.email === email);
            if (existing) {
              if (!existing.cpf && cpf && !usedCpfs.has(cpf)) {
                existing.cpf = cpf;
                usedCpfs.add(cpf);
              }
              if (!existing.whatsapp_phone_number && phone && !usedPhones.has(phone)) {
                existing.whatsapp_phone_number = phone;
                usedPhones.add(phone);
              }
            }
            continue;
          }
        }

        // 2. Unicidade de CPF
        if (cpf && usedCpfs.has(cpf)) {
          if (isWitness) {
            console.warn(`[Assinafy Guard] CPF duplicado para testemunha "${name}". Desvinculando CPF para preservar envio.`);
            cpf = undefined;
          } else {
            console.warn(`[Assinafy Guard] CPF já utilizado: "${cpf}" para "${name}". Mesclando.`);
            const existing = finalSignersForAssinafy.find(f => f.cpf === cpf);
            if (existing) {
              if (!existing.email && email && !usedEmails.has(email)) {
                existing.email = email;
                usedEmails.add(email);
              }
              if (!existing.whatsapp_phone_number && phone && !usedPhones.has(phone)) {
                existing.whatsapp_phone_number = phone;
                usedPhones.add(phone);
              }
            }
            continue;
          }
        }

        // 3. Unicidade de Telefone / WhatsApp
        if (phone && usedPhones.has(phone)) {
          if (email) {
            // Se já possui e-mail exclusivo, desvincula o telefone duplicado para evitar erro da Assinafy
            console.warn(`[Assinafy Guard] Telefone "${phone}" já em uso. Desvinculando de "${name}" pois possui e-mail "${email}".`);
            phone = undefined;
          } else {
            console.warn(`[Assinafy Guard] Telefone "${phone}" já em uso para "${name}" sem e-mail alternativo. Mesclando.`);
            continue;
          }
        }

        // 4. Unicidade de Nome
        const nameNorm = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (usedNames.has(nameNorm)) {
          const suffix = s.role ? ` (${s.role})` : ` (${i + 1})`;
          name = `${name}${suffix}`;
        }

        // Deve possuir ao menos e-mail ou WhatsApp válido
        if (!email && !phone) {
          console.warn(`[Assinafy Guard] Signatário "${name}" sem contato válido. Desconsiderando.`);
          continue;
        }

        if (email) usedEmails.add(email);
        if (phone) usedPhones.add(phone);
        if (cpf) usedCpfs.add(cpf);
        usedNames.add(name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));

        const signerPayloadItem: {
          name: string;
          email?: string;
          whatsapp_phone_number?: string;
          cpf?: string;
          metadata: { role: string };
        } = {
          name,
          metadata: { role: isWitness ? 'witness' : 'signer' }
        };

        if (email && email.trim()) {
          signerPayloadItem.email = email.trim();
        }
        if (phone && phone.trim()) {
          signerPayloadItem.whatsapp_phone_number = phone.trim();
        }
        if (cpf && cpf.trim() && cpf.trim().length === 11) {
          signerPayloadItem.cpf = cpf.trim();
        }

        finalSignersForAssinafy.push(signerPayloadItem);
      }

      if (finalSignersForAssinafy.length === 0) {
        return res.status(400).json({
          error: "Nenhum signatário válido restante para envio após validação de duplicidade."
        });
      }

      // Fazer o upload e requisitar assinaturas usando o helper de alto nível do SDK oficial
      console.log(`[Assinafy API] Executando upload e solicitação de assinaturas com ${finalSignersForAssinafy.length} signatários únicos...`);
      const result = await client.uploadAndRequestSignatures({
        source: { buffer, fileName: safeDocName },
        accountId,
        signers: finalSignersForAssinafy,
        waitForReady: true
      });

      console.log("[Assinafy API] Fluxo do SDK concluído com sucesso:", {
        documentId: result.document.id,
        status: result.document.status
      });

      const signingUrls = result.assignment.signing_urls || [];
      const mappedSigners = (result.assignment.signers || []).map((s: any, idx: number) => {
        const urlObj = signingUrls.find((su: any) => su.signer_id === s.id);
        const matched = finalSignersForAssinafy.find((u: any) => 
          (u.email && s.email && u.email.toLowerCase().trim() === s.email.toLowerCase().trim()) ||
          (u.name && s.full_name && u.name.toLowerCase().trim() === s.full_name.toLowerCase().trim())
        ) || finalSignersForAssinafy[idx];
        return {
          name: s.full_name || matched?.name,
          email: s.email || matched?.email,
          cpf: s.cpf || matched?.cpf,
          role: matched?.metadata?.role === 'witness' ? 'Testemunha' : 'signer',
          status: s.status || "Pendente",
          signUrl: urlObj?.url || `https://app.assinafy.com.br/sign/${result.document.id}/${idx}`
        };
      });

      res.json({
        success: true,
        isSandbox: false,
        envelopeId: result.document.id,
        status: result.document.status || "Pendente",
        signers: mappedSigners,
        viewUrl: (result.document as any).signing_url || `https://app.assinafy.com.br/envelopes/${result.document.id}`,
        created_at: result.document.created_at || new Date().toISOString()
      });
    } catch (apiError: any) {
      console.error("[Assinafy API Error] Erro ao integrar com a Assinafy real:", apiError.message, apiError.context || apiError.responseData || apiError);
      
      let errorDetail = apiError.message || "Erro desconhecido";
      if (apiError.responseData) {
        if (typeof apiError.responseData === "object") {
          errorDetail = apiError.responseData.message || JSON.stringify(apiError.responseData);
        } else {
          errorDetail = String(apiError.responseData);
        }
      } else if (apiError.context) {
        if (typeof apiError.context === "object") {
          errorDetail = apiError.context.message || JSON.stringify(apiError.context);
        } else {
          errorDetail = String(apiError.context);
        }
      }

      // Tratamento humanizado de erro de telefone da Assinafy
      if (typeof errorDetail === "string" && (errorDetail.toLowerCase().includes("telefone") || errorDetail.toLowerCase().includes("phone"))) {
        errorDetail = "Número de telefone/WhatsApp inválido na Assinafy. Para signatários com e-mail, o telefone é opcional. Certifique-se de preencher o e-mail ou um celular válido com DDD (ex: (21) 98888-7777).";
      }

      res.status(apiError.statusCode || 400).json({
        success: false,
        error: "Erro na autenticação ou processamento da API Assinafy",
        details: errorDetail,
        suggestSandbox: true
      });
    }
  });

  app.get("/api/assinafy/status/:envelopeId", async (req, res) => {
    const { envelopeId } = req.params;
    const { apiToken, isSandbox } = req.query;

    const isSimulated = isSandbox === "true" || 
                        !apiToken || 
                        envelopeId.startsWith("sim_") || 
                        envelopeId.startsWith("mock_") || 
                        envelopeId.startsWith("temp_") || 
                        envelopeId.startsWith("test_");

    if (isSimulated) {
      // Simular status atualizado para modo sandbox
      return res.json({
        success: true,
        isSandbox: true,
        envelopeId,
        status: "Pendente"
      });
    }

    try {
      console.log(`[Assinafy API] Buscando status real do envelope/documento: ${envelopeId}...`);
      
      const clientOptions: any = {};
      const tokenStr = String(apiToken).trim();
      if (tokenStr.startsWith("k_")) {
        clientOptions.apiKey = tokenStr;
      } else {
        clientOptions.token = tokenStr;
      }

      const client = new AssinafyClient(clientOptions);
      const details = await client.documents.details(envelopeId);

      const assignment = (details as any).assignment || {};
      const signersList = (assignment as any).signers || [];
      const signingUrls = (assignment as any).signing_urls || [];

      const mappedSigners = signersList.map((s: any) => {
        const urlObj = signingUrls.find((su: any) => su.signer_id === s.id);
        return {
          name: s.full_name || s.name,
          email: s.email,
          cpf: s.cpf,
          role: s.metadata?.role === 'witness' ? 'Testemunha' : (s.metadata?.role || "signer"),
          status: s.status || "Pendente",
          signUrl: urlObj?.url || s.sign_url || s.link
        };
      });

      res.json({
        success: true,
        isSandbox: false,
        status: details.status || "Pendente",
        signers: mappedSigners
      });
    } catch (err: any) {
      const isNotFound = err.statusCode === 404 || 
                         err.status === 404 || 
                         err.responseData?.status === 404 || 
                         (err.message && String(err.message).toLowerCase().includes("não encontrado"));
      
      const isUnauthorized = err.statusCode === 401 || 
                            err.status === 401 || 
                            err.responseData?.status === 401 ||
                            (err.message && String(err.message).toLowerCase().includes("unauthorized"));

      if (isNotFound) {
        console.warn(`[Assinafy API Status] Documento "${envelopeId}" não encontrado na Assinafy (404). Pode ter sido excluído no painel ou criado com outro token.`);
        return res.status(404).json({
          success: false,
          notFound: true,
          status: "Não Encontrado",
          error: "Documento não encontrado na Assinafy.",
          message: "Documento não encontrado."
        });
      }

      if (isUnauthorized) {
        console.warn(`[Assinafy API Status] Token de autenticação da Assinafy inválido ou expirado (401).`);
        return res.status(401).json({
          success: false,
          unauthorized: true,
          error: "Token de autenticação da Assinafy inválido ou expirado.",
          message: "Credenciais inválidas na Assinafy."
        });
      }

      console.error("[Assinafy API Status Error] Erro inesperado ao obter status do documento:", err.message, err.responseData || err);
      const httpStatus = err.statusCode || err.status || (err.responseData && err.responseData.status) || 500;
      res.status(httpStatus >= 400 && httpStatus < 600 ? httpStatus : 500).json({
        success: false,
        error: err.message,
        details: err.responseData ? JSON.stringify(err.responseData) : undefined
      });
    }
  });

  // ==========================================
  // External App Integration (EXTERNAL_APP_API_TOKEN) & SQLite Bridge DB
  // ==========================================
  let firebaseAppletConfig: { projectId?: string; apiKey?: string; firestoreDatabaseId?: string } = {};
  try {
    const cfgPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(cfgPath)) {
      firebaseAppletConfig = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
    }
  } catch (e) {
    console.warn("[External DB] Falha ao ler firebase-applet-config.json:", e);
  }

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const bridgeDb = new Database(path.join(dataDir, "external_bridge.db"));
  bridgeDb.pragma("journal_mode = WAL");
  bridgeDb.exec(`
    CREATE TABLE IF NOT EXISTS propostas (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      origem TEXT,
      status TEXT,
      empreendimento TEXT,
      unidade TEXT,
      comprador TEXT,
      valor_total REAL,
      created_at TEXT,
      updated_at TEXT,
      synced_from TEXT DEFAULT 'firestore'
    );
    CREATE TABLE IF NOT EXISTS empreendimentos (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      nome TEXT,
      status TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cargos (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      nome TEXT,
      cargo TEXT,
      email TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS configuracoes_parcelas (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      descricao TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      endpoint TEXT,
      records_count INTEGER DEFAULT 0,
      status TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clicksign_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      envelope_id TEXT,
      document_id TEXT,
      event_name TEXT,
      status TEXT,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL
    );
  `);

  const getConfiguredExternalAppToken = (): string => {
    return (
      process.env.EXTERNAL_APP_API_TOKEN ||
      process.env.EXTERNAL_API_TOKEN ||
      ""
    ).trim();
  };

  const getConfiguredExternalAppUrl = (): string => {
    return (
      process.env.EXTERNAL_APP_API_URL ||
      process.env.EXTERNAL_APP_DATABASE_URL ||
      ""
    ).trim().replace(/\/$/, "");
  };

  const extractExternalTokenFromReq = (req: express.Request): string => {
    const authHeader = req.headers?.authorization;
    if (typeof authHeader === "string" && authHeader.trim().toLowerCase().startsWith("bearer ")) {
      const token = authHeader.trim().substring(7).trim();
      if (token) return token;
    }
    const headerCandidates = [
      req.headers?.["x-api-key"],
      req.headers?.["x-external-app-token"],
      req.headers?.["x-external-token"],
      req.headers?.["x-webhook-token"],
    ];
    for (const h of headerCandidates) {
      if (typeof h === "string" && h.trim()) return h.trim();
    }
    const queryCandidates = [req.query?.token, req.query?.api_token, req.query?.apiKey];
    for (const q of queryCandidates) {
      if (typeof q === "string" && q.trim()) return q.trim();
    }
    return "";
  };

  const timingSafeTokenMatch = (provided: string, expected: string): boolean => {
    if (!provided || !expected) return false;
    const hashA = crypto.createHash("sha256").update(provided).digest();
    const hashB = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(hashA, hashB);
  };

  const requireExternalAppToken = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const expectedToken = getConfiguredExternalAppToken();
    if (!expectedToken) {
      return res.status(503).json({
        success: false,
        error: "EXTERNAL_APP_API_TOKEN não configurado nas variáveis de ambiente do servidor.",
        code: "EXTERNAL_TOKEN_NOT_CONFIGURED"
      });
    }
    const providedToken = extractExternalTokenFromReq(req);
    if (!providedToken || !timingSafeTokenMatch(providedToken, expectedToken)) {
      return res.status(401).json({
        success: false,
        error: "Token de API inválido ou ausente (EXTERNAL_APP_API_TOKEN).",
        code: "INVALID_EXTERNAL_TOKEN"
      });
    }
    next();
  };

  const firebaseTokenCache = new Map<string, { uid: string; email: string; expiresAt: number }>();

  const verifyFirebaseClientSession = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const authHeader = req.headers?.authorization;
    const idToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : "";
    if (!idToken) {
      return res.status(401).json({ success: false, error: "Sessão Firebase não autenticada." });
    }
    const tokenHash = crypto.createHash("sha256").update(idToken).digest("hex");
    const cached = firebaseTokenCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      (req as any).firebaseUser = { uid: cached.uid, email: cached.email };
      return next();
    }
    if (!firebaseAppletConfig.apiKey) {
      return res.status(500).json({ success: false, error: "Configuração Firebase ausente no servidor." });
    }
    try {
      const lookupRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseAppletConfig.apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken })
        }
      );
      if (!lookupRes.ok) {
        return res.status(401).json({ success: false, error: "Token de sessão Firebase inválido ou expirado." });
      }
      const lookupData: any = await lookupRes.json();
      const userObj = lookupData?.users?.[0];
      if (!userObj?.localId) {
        return res.status(401).json({ success: false, error: "Usuário Firebase não encontrado." });
      }
      firebaseTokenCache.set(tokenHash, {
        uid: userObj.localId,
        email: userObj.email || "",
        expiresAt: Date.now() + 5 * 60 * 1000
      });
      (req as any).firebaseUser = { uid: userObj.localId, email: userObj.email || "" };
      next();
    } catch (err: any) {
      return res.status(500).json({ success: false, error: "Falha ao verificar sessão Firebase: " + err.message });
    }
  };

  const isSafeExternalUrl = (rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
      const host = parsed.hostname.toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host === "169.254.169.254" ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^169\.254\./.test(host)
      ) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const normalizeExternalProposal = (rawData: any, detectedOrigem = "PropostasMax", forcedId?: string) => {
    const property = {
      empreendimento: rawData.property?.empreendimento || rawData.empreendimento || rawData.empreendimentoNome || "",
      unidade: String(rawData.property?.unidade || rawData.unidade || rawData.unidadeNumero || ""),
      torre: rawData.property?.torre || rawData.torre || "",
      cidade: rawData.property?.cidade || rawData.cidade || "",
      estado: rawData.property?.estado || rawData.estado || "",
      endereco: rawData.property?.endereco || rawData.endereco || "",
    };

    let rawCustomers = rawData.customers || (rawData.customer ? [rawData.customer] : []);
    if (!Array.isArray(rawCustomers) || rawCustomers.length === 0) {
      rawCustomers = [{
        nome: rawData.nome_comprador || rawData.nomeComprador || rawData.comprador || "Comprador a Definir",
        cpf: rawData.cpf_comprador || rawData.cpfComprador || rawData.cpf || "",
        telefone: rawData.telefone || "",
        email: rawData.email || ""
      }];
    }

    const customers = rawCustomers.map((c: any) => ({
      nome: c.nome || c.name || "",
      cpf: c.cpf || "",
      telefone: c.telefone || c.phone || "",
      email: c.email || "",
      dataNascimento: c.dataNascimento || c.data_nascimento || "",
      rgNumero: c.rgNumero || c.rg_numero || c.rg || "",
      rgOrgao: c.rgOrgao || c.rg_orgao || "",
      rgDataExpedicao: c.rgDataExpedicao || c.rg_data_expedicao || "",
      estadoCivil: c.estadoCivil || c.estado_civil || "Solteiro(a)",
      profissao: c.profissao || "",
      naturalidade: c.naturalidade || "",
      nacionalidade: c.nacionalidade || "Brasileira",
      address: c.address || rawData.address || {
        cep: "",
        logradouro: "",
        numero: "",
        complemento: "",
        bairro: "",
        cidade: "",
        estado: ""
      }
    }));

    const salesTeam = {
      corretor1: rawData.salesTeam?.corretor1 || rawData.sales_team?.corretor1 || rawData.corretor1 || rawData.corretor || "",
      corretor2: rawData.salesTeam?.corretor2 || rawData.sales_team?.corretor2 || rawData.corretor2 || "",
      gerente: rawData.salesTeam?.gerente || rawData.sales_team?.gerente || rawData.gerente || "",
      diretor: rawData.salesTeam?.diretor || rawData.sales_team?.diretor || rawData.diretor || "",
      coordenador: rawData.salesTeam?.coordenador || rawData.sales_team?.coordenador || rawData.coordenador || ""
    };

    let rawPayments = rawData.payments || rawData.parcelas || [];
    if (!Array.isArray(rawPayments)) {
      rawPayments = [];
    }

    const payments = rawPayments.map((p: any) => {
      const quantidade = Number(p.quantidade) || 1;
      const valorUnitario = Number(p.valorUnitario ?? p.valor_unitario ?? p.valor ?? 0);
      const valorTotal = Number(p.valorTotal ?? p.valor_total ?? (quantidade * valorUnitario));
      return {
        quantidade,
        tipo: p.tipo || "Mensal",
        valorUnitario,
        vencimento: p.vencimento || new Date().toISOString().split("T")[0],
        valorTotal
      };
    });

    const calculatedTotal = payments.reduce((acc: number, p: any) => acc + (p.valorTotal || 0), 0);
    const valorTotalProposta = Number(rawData.valorTotalProposta ?? rawData.valor_total_proposta ?? rawData.valorVenda ?? calculatedTotal);

    const calculatedEntrada = payments
      .filter((p: any) => {
        const t = (p.tipo || "").toLowerCase();
        return t.includes("ato") || t.includes("sinal") || t.includes("entrada") || t.includes("princípio");
      })
      .reduce((acc: number, p: any) => acc + (p.valorTotal || 0), 0);

    const valorEntrada = Number(rawData.valorEntrada ?? rawData.valor_entrada ?? calculatedEntrada);

    const documents = Array.isArray(rawData.documents) ? rawData.documents : [
      { type: "Documento de Identidade (RG/CNH)", found: !!customers[0]?.rgNumero, description: "Identificação dos proponentes" },
      { type: "Cadastro de Pessoa Física (CPF)", found: !!customers[0]?.cpf, description: "CPF regularizado" },
      { type: "Comprovante de Residência", found: !!(customers[0]?.address?.logradouro), description: "Comprovante de domicílio" },
      { type: "Proposta Comercial Assinada", found: true, description: `Recebida de ${detectedOrigem}` }
    ];

    const proposalId = forcedId || (rawData.id ? String(rawData.id) : `ext-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`);

    return {
      ...rawData,
      id: proposalId,
      external_id: rawData.external_id || rawData.id || proposalId,
      property,
      customers,
      salesTeam,
      sales_team: salesTeam,
      address: customers[0]?.address || { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "" },
      payments,
      valorTotalProposta,
      valorEntrada,
      percentualComissao: Number(rawData.percentualComissao ?? 5),
      proposta_status: rawData.proposta_status || "AGUARDANDO APROVAÇÃO",
      cvc_status: rawData.cvc_status || "PENDENTE",
      corretagem_status: rawData.corretagem_status || "PENDENTE",
      status: rawData.status || "na fila",
      forma_pagamento_comissao: rawData.forma_pagamento_comissao || "PAGADORIA",
      tipo_minuta_corretagem: rawData.tipo_minuta_corretagem || "PADRAO",
      informacoes_adicionais: rawData.informacoes_adicionais || `Proposta recebida via integração com ${detectedOrigem}.`,
      documents,
      validations: rawData.validations || {
        cpfMatch: true,
        totalValueMatch: payments.length === 0 || Math.abs(valorTotalProposta - calculatedTotal) < 1,
        message: `Importado com sucesso via integração ${detectedOrigem}`
      },
      origem: detectedOrigem,
      created_at: rawData.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  };

  const upsertProposalToBridgeDb = (proposal: any, syncedFrom: string) => {
    const nowIso = new Date().toISOString();
    const comprador = proposal.customers?.[0]?.nome || proposal.customer?.nome || "";
    const stmt = bridgeDb.prepare(`
      INSERT INTO propostas (id, payload, origem, status, empreendimento, unidade, comprador, valor_total, created_at, updated_at, synced_from)
      VALUES (@id, @payload, @origem, @status, @empreendimento, @unidade, @comprador, @valor_total, @created_at, @updated_at, @synced_from)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        origem = COALESCE(excluded.origem, propostas.origem),
        status = COALESCE(excluded.status, propostas.status),
        empreendimento = COALESCE(excluded.empreendimento, propostas.empreendimento),
        unidade = COALESCE(excluded.unidade, propostas.unidade),
        comprador = COALESCE(excluded.comprador, propostas.comprador),
        valor_total = COALESCE(excluded.valor_total, propostas.valor_total),
        updated_at = excluded.updated_at,
        synced_from = excluded.synced_from
    `);
    stmt.run({
      id: String(proposal.id),
      payload: JSON.stringify(proposal),
      origem: String(proposal.origem || "Sistema"),
      status: String(proposal.status || proposal.proposta_status || "na fila"),
      empreendimento: String(proposal.property?.empreendimento || ""),
      unidade: String(proposal.property?.unidade || ""),
      comprador: String(comprador),
      valor_total: Number(proposal.valorTotalProposta) || 0,
      created_at: String(proposal.created_at || nowIso),
      updated_at: nowIso,
      synced_from: syncedFrom
    });
  };

  const recentImportedProposals: any[] = [];
  const recentNotifications: any[] = [];
  try {
    const persistedRows = bridgeDb
      .prepare("SELECT payload FROM propostas WHERE synced_from IN ('webhook', 'external_api', 'external_sync') ORDER BY updated_at DESC LIMIT 50")
      .all() as Array<{ payload: string }>;
    for (const row of persistedRows) {
      try {
        recentImportedProposals.push(JSON.parse(row.payload));
      } catch {}
    }
  } catch (e) {
    console.warn("[External DB] Falha ao carregar cache inicial do SQLite:", e);
  }

  const registeredUserWebhooks = new Map<string, {
    userId: string;
    userEmail?: string;
    userName?: string;
    webhookUrl: string;
    webhookActive: boolean;
    webhookToken?: string;
    webhookEvents?: string[];
    lastDispatch?: string;
    lastStatus?: string;
  }>();

  app.get("/api/propostas/schema", (req, res) => {
    res.json({
      title: "PropostaImobiliariaRJ",
      description: "Esquema JSON padrão para propostas geradas no Google AI Studio prontas para confecção de contratos e rateio imobiliário",
      type: "object",
      properties: {
        property: {
          type: "object",
          description: "Dados do imóvel e empreendimento",
          properties: {
            empreendimento: { type: "string", description: "Nome do empreendimento ou condomínio" },
            unidade: { type: "string", description: "Número da unidade ou apartamento (ex: 302, Bloco A - 405)" },
            torre: { type: "string", description: "Nome da torre ou bloco (opcional)" },
            cidade: { type: "string", description: "Cidade do empreendimento" },
            estado: { type: "string", description: "UF do empreendimento (ex: RJ, SP)" },
            endereco: { type: "string", description: "Endereço completo do empreendimento" }
          },
          required: ["empreendimento", "unidade"]
        },
        customers: {
          type: "array",
          description: "Lista de proponentes compradores qualificados para o contrato",
          items: {
            type: "object",
            properties: {
              nome: { type: "string", description: "Nome completo do comprador" },
              cpf: { type: "string", description: "CPF do comprador (apenas números ou formatado)" },
              telefone: { type: "string", description: "Telefone de contato ou WhatsApp" },
              email: { type: "string", description: "E-mail do comprador" },
              rgNumero: { type: "string", description: "Número do documento de identidade (RG/CNH)" },
              rgOrgao: { type: "string", description: "Órgão emissor do RG (ex: SSP/RJ, DETRAN/RJ)" },
              rgDataExpedicao: { type: "string", description: "Data de expedição do RG" },
              dataNascimento: { type: "string", description: "Data de nascimento" },
              estadoCivil: { type: "string", description: "Estado civil (Solteiro, Casado, etc.)" },
              profissao: { type: "string", description: "Profissão do comprador" },
              naturalidade: { type: "string", description: "Cidade e estado de nascimento" },
              nacionalidade: { type: "string", description: "Nacionalidade (padrão: Brasileira)" },
              address: {
                type: "object",
                properties: {
                  cep: { type: "string" },
                  logradouro: { type: "string" },
                  numero: { type: "string" },
                  complemento: { type: "string" },
                  bairro: { type: "string" },
                  cidade: { type: "string" },
                  estado: { type: "string" }
                }
              }
            },
            required: ["nome", "cpf"]
          }
        },
        salesTeam: {
          type: "object",
          description: "Equipe de vendas envolvida na negociação",
          properties: {
            corretor1: { type: "string", description: "Nome do Corretor principal" },
            corretor2: { type: "string", description: "Nome do Corretor co-participante (se houver)" },
            gerente: { type: "string", description: "Nome do Gerente de vendas" },
            diretor: { type: "string", description: "Nome do Diretor comercial" },
            coordenador: { type: "string", description: "Nome do Coordenador" }
          }
        },
        payments: {
          type: "array",
          description: "Fluxo de pagamentos da proposta (parcelas brutas)",
          items: {
            type: "object",
            properties: {
              quantidade: { type: "integer", description: "Quantidade de parcelas deste tipo" },
              tipo: { type: "string", description: "Tipo da parcela: Ato, Sinal, Mensal, Intermediária, Semestral, Chaves, Financiamento" },
              valorUnitario: { type: "number", description: "Valor unitário de cada parcela" },
              vencimento: { type: "string", description: "Data do primeiro vencimento (AAAA-MM-DD)" },
              valorTotal: { type: "number", description: "Valor total do grupo (quantidade * valorUnitario)" }
            },
            required: ["quantidade", "tipo", "valorUnitario", "valorTotal"]
          }
        },
        valorTotalProposta: { type: "number", description: "Valor total da proposta comercial (VGV)" },
        valorEntrada: { type: "number", description: "Valor total das parcelas de entrada (sinal/ato)" },
        percentualComissao: { type: "number", description: "Taxa global de comissão em porcentagem (ex: 5.00)" },
        documents: {
          type: "array",
          description: "Relação de documentos verificados nos anexos",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "Tipo de documento (ex: RG, CPF, Certidão de Estado Civil, Comprovante de Residência, Holerite/Renda, Formulário de Proposta)" },
              found: { type: "boolean", description: "Se o documento foi devidamente anexado/conferido" },
              description: { type: "string", description: "Observação sobre a documentação" }
            }
          }
        },
        informacoes_adicionais: { type: "string", description: "Condições especiais, carências ou observações contratuais" }
      },
      required: ["property", "customers", "payments"]
    });
  });

  app.post("/api/propostas/importar", upload.single("file"), async (req, res) => {
    try {
      // Validate token if EXTERNAL_APP_API_TOKEN is configured and caller sends a token header/query
      const configuredExternalToken = getConfiguredExternalAppToken();
      const providedToken = extractExternalTokenFromReq(req);
      if (configuredExternalToken && providedToken) {
        const matchesExternal = timingSafeTokenMatch(providedToken, configuredExternalToken);
        const matchesUserWebhook = Array.from(registeredUserWebhooks.values()).some(
          w => w.webhookToken && timingSafeTokenMatch(providedToken, w.webhookToken)
        );
        const matchesLegacySample = providedToken === "propostasmax_token";
        if (!matchesExternal && !matchesUserWebhook && !matchesLegacySample) {
          return res.status(401).json({
            success: false,
            error: "Token de autenticação inválido (EXTERNAL_APP_API_TOKEN)."
          });
        }
      }

      let rawData: any = null;

      // 1. Check if uploaded as file
      if (req.file && req.file.buffer) {
        try {
          const content = req.file.buffer.toString("utf-8");
          rawData = JSON.parse(content);
        } catch (e: any) {
          return res.status(400).json({ error: "O arquivo enviado não contém um JSON válido: " + e.message });
        }
      } else if (req.body) {
        // 2. Check direct JSON body or wrapped in { proposta: ... }
        if (typeof req.body === "string") {
          try {
            rawData = JSON.parse(req.body);
          } catch (e: any) {
            return res.status(400).json({ error: "Formato de JSON inválido no corpo da requisição" });
          }
        } else {
          rawData = req.body.proposta || req.body;
        }
      }

      if (!rawData || typeof rawData !== "object") {
        return res.status(400).json({ error: "Payload da proposta não fornecido ou inválido" });
      }

      const rawOrigem = rawData.origem || rawData.source || req.headers["x-source"] || req.query.origem;
      const detectedOrigem = rawOrigem ? String(rawOrigem) : "PropostasMax";
      const normalizedProposal = normalizeExternalProposal(rawData, detectedOrigem);
      const { property, customers, salesTeam, payments, valorTotalProposta, valorEntrada, id: proposalId } = normalizedProposal;

      if (!property.empreendimento || !property.unidade) {
        return res.status(422).json({
          error: "Dados incompletos: 'property.empreendimento' e 'property.unidade' são campos obrigatórios para gerar o contrato.",
          received: { property }
        });
      }

      // Persistir no SQLite e guardar na fila recente para sincronização instantânea
      upsertProposalToBridgeDb(normalizedProposal, "webhook");
      const existingIdx = recentImportedProposals.findIndex(p => p.id === proposalId);
      if (existingIdx !== -1) recentImportedProposals.splice(existingIdx, 1);
      recentImportedProposals.unshift(normalizedProposal);
      if (recentImportedProposals.length > 50) {
        recentImportedProposals.pop();
      }

      // Criar evento de notificação em tempo real
      const newNotification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        proposalId,
        origem: detectedOrigem,
        title: `Nova Proposta Recebida: ${detectedOrigem}`,
        message: `${property.empreendimento} - Unidade ${property.unidade} | ${customers[0]?.nome || 'Comprador a Definir'}`,
        empreendimento: property.empreendimento,
        unidade: property.unidade,
        comprador: customers[0]?.nome || "A definir",
        valorTotal: valorTotalProposta,
        valorEntrada,
        created_at: new Date().toISOString(),
        read: false,
        proposta: normalizedProposal
      };
      recentNotifications.unshift(newNotification);
      if (recentNotifications.length > 50) {
        recentNotifications.pop();
      }

      // Notificação automática via Gmail se os tokens estiverem ativos
      try {
        const tokens = extractGoogleTokens(req);
        if (tokens) {
          const auth = getOAuth2Client(req.headers.host);
          setCredentialsAndListen(auth, tokens, res);
          const gmail = google.gmail({ version: "v1", auth });
          const subject = `[${detectedOrigem}] 🔔 Nova Proposta Recebida: ${property.empreendimento} - Unid. ${property.unidade}`;
          const bodyText = [
            `Olá,`,
            ``,
            `Uma nova proposta acaba de ser recebida com sucesso do aplicativo ${detectedOrigem}!`,
            ``,
            `📌 RESUMO DA PROPOSTA:`,
            `- Empreendimento: ${property.empreendimento}`,
            `- Unidade: ${property.unidade} ${property.torre ? `(${property.torre})` : ''}`,
            `- Comprador Principal: ${customers[0]?.nome || 'Não informado'} (CPF: ${customers[0]?.cpf || 'Não informado'})`,
            `- Valor Total (VGV): R$ ${valorTotalProposta.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            `- Sinal/Entrada: R$ ${valorEntrada.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            `- Quantidade de Parcelas: ${payments.length}`,
            `- Corretor: ${salesTeam.corretor1 || 'Não informado'}`,
            `- Gerente: ${salesTeam.gerente || 'Não informado'}`,
            ``,
            `Os dados já estão disponíveis no sistema para conferência, cálculo do rateio de comissão e emissão da Minuta de Corretagem e CVC.`,
            ``,
            `Atenciosamente,`,
            `Sistema de Rateio & Contratos Imobiliários RJ`
          ].join("\n");

          const rawMail = [
            `To: propostasrej@gmail.com`,
            `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
            "MIME-Version: 1.0",
            'Content-Type: text/plain; charset="utf-8"',
            "Content-Transfer-Encoding: 7bit",
            "",
            bodyText
          ].join("\r\n");

          gmail.users.messages.send({
            userId: "me",
            requestBody: {
              raw: Buffer.from(rawMail).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
            }
          }).then(() => {
            console.log(`[Notification Email] E-mail de notificação enviado para propostasrej@gmail.com`);
          }).catch((mailErr: any) => {
            console.warn(`[Notification Email] Aviso: Falha ao enviar e-mail via Gmail API (${mailErr.message})`);
          });
        }
      } catch (e: any) {
        console.warn(`[Notification Email] Exceção ao tentar enviar e-mail:`, e.message);
      }

      // Disparo assíncrono para os Webhooks configurados nos usuários
      try {
        const outboundPayload = {
          event: "proposta.recebida",
          timestamp: new Date().toISOString(),
          origem: detectedOrigem,
          proposalId,
          proposta: normalizedProposal,
          resumo: {
            empreendimento: property.empreendimento,
            unidade: property.unidade,
            torre: property.torre || "",
            comprador: customers[0]?.nome || "A definir",
            cpf: customers[0]?.cpf || "",
            telefone: customers[0]?.telefone || "",
            email: customers[0]?.email || "",
            valorTotal: valorTotalProposta,
            valorEntrada,
            quantidadeParcelas: payments.length,
            corretor: salesTeam.corretor1 || "",
            gerente: salesTeam.gerente || ""
          }
        };

        // 1. Destinatários registrados em cache de usuários
        for (const [uid, userWebhook] of registeredUserWebhooks.entries()) {
          if (userWebhook.webhookActive && userWebhook.webhookUrl) {
            const events = userWebhook.webhookEvents || ["proposta.recebida"];
            if (events.length === 0 || events.includes("proposta.recebida") || events.includes("all")) {
              const targetUrl = userWebhook.webhookUrl;
              const targetToken = userWebhook.webhookToken;
              console.log(`[User Webhook Dispatch] Enviando evento proposta.recebida para usuário ${userWebhook.userName || uid} (${targetUrl})...`);
              
              const dispatchController = new AbortController();
              const timeout = setTimeout(() => dispatchController.abort(), 6000);
              fetch(targetUrl, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(targetToken ? { "X-Webhook-Token": targetToken, "Authorization": `Bearer ${targetToken}` } : {})
                },
                body: JSON.stringify(outboundPayload),
                signal: dispatchController.signal
              }).then(async (resp) => {
                clearTimeout(timeout);
                userWebhook.lastDispatch = new Date().toISOString();
                userWebhook.lastStatus = `HTTP ${resp.status} ${resp.statusText}`;
                console.log(`[User Webhook Dispatch] Sucesso: ${targetUrl} respondeu com HTTP ${resp.status}`);
              }).catch((dispatchErr) => {
                clearTimeout(timeout);
                userWebhook.lastDispatch = new Date().toISOString();
                userWebhook.lastStatus = `Erro: ${dispatchErr.message}`;
                console.warn(`[User Webhook Dispatch] Falha ao enviar para ${targetUrl}:`, dispatchErr.message);
              });
            }
          }
        }

        // 2. Destinatário específico se enviado no header ou query (ex: ?webhookUrl=...)
        const directWebhookUrl = req.headers["x-webhook-url"] || req.query.webhookUrl || rawData.webhookUrl;
        if (directWebhookUrl && typeof directWebhookUrl === "string" && directWebhookUrl.startsWith("http")) {
          const directToken = req.headers["x-webhook-token"] || req.query.webhookToken || rawData.webhookToken;
          fetch(directWebhookUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(directToken ? { "X-Webhook-Token": String(directToken) } : {})
            },
            body: JSON.stringify(outboundPayload)
          }).catch(err => console.warn(`[Direct Webhook Error]`, err.message));
        }
      } catch (webhookDispatchErr: any) {
        console.warn(`[User Webhook Dispatch Error]`, webhookDispatchErr.message);
      }

      console.log(`[Google AI Studio / ${detectedOrigem}] Proposta recebida com sucesso: ${property.empreendimento} - Unidade ${property.unidade}`);

      res.status(200).json({
        success: true,
        message: `Proposta recebida do ${detectedOrigem} com sucesso e pronta para confecção de contratos!`,
        id: proposalId,
        origem: detectedOrigem,
        notification: newNotification,
        proposta: normalizedProposal
      });
    } catch (err: any) {
      console.error("[Google AI Studio Import Error]:", err);
      res.status(500).json({
        success: false,
        error: "Erro interno ao processar a importação da proposta",
        details: err.message
      });
    }
  });

  // ==========================================
  // Endpoints de Gerenciamento de Webhooks nos Usuários
  // ==========================================

  // Sincronizar cache de webhooks de usuários ativos do Firestore para o backend
  app.post("/api/users/webhooks/sync", (req, res) => {
    try {
      const { users } = req.body || {};
      if (Array.isArray(users)) {
        users.forEach((u: any) => {
          if (u.id || u.userId) {
            const uid = u.id || u.userId;
            registeredUserWebhooks.set(uid, {
              userId: uid,
              userEmail: u.email,
              userName: u.displayName || u.nome || u.email,
              webhookUrl: u.webhookUrl || "",
              webhookActive: u.webhookActive !== false && Boolean(u.webhookUrl),
              webhookToken: u.webhookToken || "",
              webhookEvents: u.webhookEvents || ["proposta.recebida"],
              lastDispatch: u.lastWebhookDispatch,
              lastStatus: u.lastWebhookStatus
            });
          }
        });
      }
      res.json({
        success: true,
        registeredCount: registeredUserWebhooks.size,
        message: "Webhooks sincronizados com sucesso no backend!"
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Listar webhooks de usuários registrados no cache
  app.get("/api/users/webhooks", (req, res) => {
    const list = Array.from(registeredUserWebhooks.values());
    res.json({
      success: true,
      count: list.length,
      webhooks: list
    });
  });

  // Testar disparo de Webhook em tempo real
  app.post("/api/webhook/test-dispatch", async (req, res) => {
    try {
      const { url, token, event, payload, userName } = req.body || {};
      if (!url || typeof url !== "string" || !url.startsWith("http")) {
        return res.status(400).json({
          success: false,
          error: "URL inválida. A URL deve começar com http:// ou https://"
        });
      }

      const testPayload = payload || {
        event: event || "proposta.recebida",
        timestamp: new Date().toISOString(),
        origem: "PropostasMax / Rateio Imobiliário RJ",
        message: `Teste de disparo de Webhook para ${userName || 'Usuário'} executado com sucesso!`,
        dados: {
          empreendimento: "Residencial Jardins da Barra",
          unidade: "402",
          torre: "Torre Sol",
          comprador: "Carlos Eduardo da Silva",
          cpf: "123.456.789-00",
          valorVenda: 600000,
          valorEntrada: 50000,
          status: "AGUARDANDO APROVAÇÃO"
        }
      };

      const startTime = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Sistema-Rateio-Imobiliario-RJ/1.0",
          ...(token ? { "X-Webhook-Token": token, "Authorization": `Bearer ${token}` } : {})
        },
        body: JSON.stringify(testPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startTime;
      const responseText = await resp.text();
      const truncatedBody = responseText.length > 500 ? responseText.substring(0, 500) + "..." : responseText;

      res.json({
        success: resp.ok,
        statusCode: resp.status,
        statusText: resp.statusText,
        latencyMs,
        responseBody: truncatedBody,
        message: resp.ok 
          ? `Webhook respondeu com sucesso (HTTP ${resp.status} ${resp.statusText}) em ${latencyMs}ms!` 
          : `O servidor de destino respondeu com erro HTTP ${resp.status} (${resp.statusText}).`
      });
    } catch (err: any) {
      const isTimeout = err.name === "AbortError";
      res.status(500).json({
        success: false,
        error: isTimeout 
          ? "Tempo limite esgotado (timeout de 7s). O endpoint do webhook demorou para responder ou está inacessível."
          : `Falha na conexão: ${err.message}`
      });
    }
  });

  // Endpoints de Notificações
  app.get("/api/notifications", (req, res) => {
    const unreadCount = recentNotifications.filter(n => !n.read).length;
    res.json({
      success: true,
      unreadCount,
      notifications: recentNotifications
    });
  });

  app.post("/api/notifications/mark-read", (req, res) => {
    const { id, all } = req.body || {};
    if (all) {
      recentNotifications.forEach(n => { n.read = true; });
    } else if (id) {
      const item = recentNotifications.find(n => n.id === id);
      if (item) item.read = true;
    }
    res.json({ success: true, unreadCount: recentNotifications.filter(n => !n.read).length });
  });

  app.post("/api/notifications/test", (req, res) => {
    const sampleId = `test-${Date.now()}`;
    const testProp = {
      empreendimento: "Residencial Jardins da Barra",
      unidade: "402",
      torre: "Torre Sol",
      cidade: "Rio de Janeiro",
      estado: "RJ",
      endereco: "Av. das Américas, 4500"
    };
    const testCust = [{
      nome: "Carlos Eduardo da Silva",
      cpf: "123.456.789-00",
      telefone: "(21) 98765-4321",
      email: "carlos.silva@exemplo.com",
      rgNumero: "12.345.678-9",
      rgOrgao: "DETRAN/RJ",
      rgDataExpedicao: "2015-05-12",
      dataNascimento: "1985-08-20",
      estadoCivil: "Casado(a)",
      profissao: "Engenheiro Civil",
      naturalidade: "Rio de Janeiro - RJ",
      nacionalidade: "Brasileira",
      address: {
        cep: "22640-100",
        logradouro: "Rua Olegário Maciel",
        numero: "250",
        complemento: "Apto 302",
        bairro: "Barra da Tijuca",
        cidade: "Rio de Janeiro",
        estado: "RJ"
      }
    }];
    const testPayments = [
      { quantidade: 1, tipo: "Ato / Sinal", valorUnitario: 50000, vencimento: "2026-10-05", valorTotal: 50000 },
      { quantidade: 36, tipo: "Mensal", valorUnitario: 4000, vencimento: "2026-11-05", valorTotal: 144000 },
      { quantidade: 4, tipo: "Intermediária", valorUnitario: 20000, vencimento: "2027-04-05", valorTotal: 80000 },
      { quantidade: 1, tipo: "Financiamento", valorUnitario: 326000, vencimento: "2029-10-05", valorTotal: 326000 }
    ];

    const testProposal = {
      id: sampleId,
      property: testProp,
      customers: testCust,
      salesTeam: { corretor1: "Roberto Almeida", corretor2: "", gerente: "Marcos Vinicius", diretor: "Juliana Prado", coordenador: "Aline Costa" },
      sales_team: { corretor1: "Roberto Almeida", corretor2: "", gerente: "Marcos Vinicius", diretor: "Juliana Prado", coordenador: "Aline Costa" },
      address: testCust[0].address,
      payments: testPayments,
      valorTotalProposta: 600000,
      valorEntrada: 50000,
      percentualComissao: 5.0,
      proposta_status: "AGUARDANDO APROVAÇÃO",
      cvc_status: "PENDENTE",
      corretagem_status: "PENDENTE",
      forma_pagamento_comissao: "PAGADORIA",
      tipo_minuta_corretagem: "PADRAO",
      informacoes_adicionais: "Proposta de teste recebida do PropostasMax.",
      documents: [
        { type: "Documento de Identidade (RG/CNH)", found: true, description: "RG expedido pelo DETRAN/RJ conferido" },
        { type: "Cadastro de Pessoa Física (CPF)", found: true, description: "CPF regularizado" },
        { type: "Comprovante de Residência", found: true, description: "Comprovante recente anexado" },
        { type: "Proposta Comercial", found: true, description: "Emitida pelo PropostasMax" }
      ],
      validations: { cpfMatch: true, totalValueMatch: true, message: "Teste gerado com sucesso" },
      origem: "PropostasMax",
      created_at: new Date().toISOString()
    };

    recentImportedProposals.unshift(testProposal);

    const testNotif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      proposalId: sampleId,
      origem: "PropostasMax",
      title: "Nova Proposta Recebida: PropostasMax",
      message: `${testProp.empreendimento} - Unidade ${testProp.unidade} | ${testCust[0].nome}`,
      empreendimento: testProp.empreendimento,
      unidade: testProp.unidade,
      comprador: testCust[0].nome,
      valorTotal: 600000,
      valorEntrada: 50000,
      created_at: new Date().toISOString(),
      read: false,
      proposta: testProposal
    };

    recentNotifications.unshift(testNotif);

    res.json({
      success: true,
      message: "Notificação de teste do PropostasMax gerada com sucesso!",
      notification: testNotif
    });
  });

  app.get("/api/propostas/recentes", (req, res) => {
    res.json({
      success: true,
      count: recentImportedProposals.length,
      propostas: recentImportedProposals
    });
  });

  app.delete("/api/propostas/recentes/:id", (req, res) => {
    const { id } = req.params;
    const initialLen = recentImportedProposals.length;
    const idx = recentImportedProposals.findIndex(p => p.id === id);
    if (idx !== -1) {
      recentImportedProposals.splice(idx, 1);
    }
    try {
      bridgeDb.prepare("DELETE FROM propostas WHERE id = ? AND synced_from IN ('webhook', 'external_api', 'external_sync')").run(id);
    } catch {}
    res.json({
      success: true,
      removed: initialLen !== recentImportedProposals.length,
      count: recentImportedProposals.length
    });
  });

  app.post("/api/propostas/recentes/clear", (req, res) => {
    recentImportedProposals.length = 0;
    try {
      bridgeDb.prepare("DELETE FROM propostas WHERE synced_from IN ('webhook', 'external_api', 'external_sync')").run();
    } catch {}
    res.json({ success: true, message: "Fila de propostas recentes limpa com sucesso!" });
  });

  // ==========================================
  // Inbound External App Database API (/api/external/*)
  // Protected by EXTERNAL_APP_API_TOKEN
  // ==========================================
  app.get("/api/external/health", requireExternalAppToken, (req, res) => {
    const counts = {
      propostas: (bridgeDb.prepare("SELECT COUNT(*) as c FROM propostas").get() as any)?.c || 0,
      empreendimentos: (bridgeDb.prepare("SELECT COUNT(*) as c FROM empreendimentos").get() as any)?.c || 0,
      cargos: (bridgeDb.prepare("SELECT COUNT(*) as c FROM cargos").get() as any)?.c || 0,
      configuracoes_parcelas: (bridgeDb.prepare("SELECT COUNT(*) as c FROM configuracoes_parcelas").get() as any)?.c || 0,
    };
    res.json({
      success: true,
      authenticated: true,
      database: "external_bridge_sqlite",
      counts,
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/external/database/summary", requireExternalAppToken, (req, res) => {
    const counts = {
      propostas: (bridgeDb.prepare("SELECT COUNT(*) as c FROM propostas").get() as any)?.c || 0,
      empreendimentos: (bridgeDb.prepare("SELECT COUNT(*) as c FROM empreendimentos").get() as any)?.c || 0,
      cargos: (bridgeDb.prepare("SELECT COUNT(*) as c FROM cargos").get() as any)?.c || 0,
      configuracoes_parcelas: (bridgeDb.prepare("SELECT COUNT(*) as c FROM configuracoes_parcelas").get() as any)?.c || 0,
    };
    res.json({
      success: true,
      counts,
      endpoints: {
        propostas: "/api/external/propostas",
        empreendimentos: "/api/external/empreendimentos",
        cargos: "/api/external/cargos",
        configuracoesParcelas: "/api/external/configuracoes-parcelas"
      }
    });
  });

  app.get("/api/external/propostas", requireExternalAppToken, (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "";
    const empFilter = typeof req.query.empreendimento === "string" ? req.query.empreendimento.trim().toLowerCase() : "";
    const origemFilter = typeof req.query.origem === "string" ? req.query.origem.trim().toLowerCase() : "";
    const searchFilter = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

    const rows = bridgeDb
      .prepare("SELECT payload, synced_from, updated_at FROM propostas ORDER BY created_at DESC")
      .all() as Array<{ payload: string; synced_from: string; updated_at: string }>;

    let items = rows.map(r => {
      try {
        return { ...JSON.parse(r.payload), _synced_from: r.synced_from, _updated_at: r.updated_at };
      } catch {
        return null;
      }
    }).filter(Boolean) as any[];

    if (statusFilter) {
      items = items.filter(p => String(p.status || p.proposta_status || "").toLowerCase().includes(statusFilter));
    }
    if (empFilter) {
      items = items.filter(p => String(p.property?.empreendimento || "").toLowerCase().includes(empFilter));
    }
    if (origemFilter) {
      items = items.filter(p => String(p.origem || "").toLowerCase().includes(origemFilter));
    }
    if (searchFilter) {
      items = items.filter(p =>
        String(p.property?.empreendimento || "").toLowerCase().includes(searchFilter) ||
        String(p.property?.unidade || "").toLowerCase().includes(searchFilter) ||
        String(p.customers?.[0]?.nome || "").toLowerCase().includes(searchFilter) ||
        String(p.customers?.[0]?.cpf || "").toLowerCase().includes(searchFilter)
      );
    }

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);
    res.json({ success: true, total, count: paginated.length, limit, offset, propostas: paginated });
  });

  app.get("/api/external/propostas/:id", requireExternalAppToken, (req, res) => {
    const row = bridgeDb.prepare("SELECT payload FROM propostas WHERE id = ?").get(req.params.id) as { payload: string } | undefined;
    if (!row) {
      return res.status(404).json({ success: false, error: "Proposta não encontrada." });
    }
    res.json({ success: true, proposta: JSON.parse(row.payload) });
  });

  app.post("/api/external/propostas", requireExternalAppToken, (req, res) => {
    try {
      const body = req.body || {};
      const list = Array.isArray(body.propostas)
        ? body.propostas
        : Array.isArray(body)
        ? body
        : [body.proposta || body];

      const imported: any[] = [];
      for (const rawItem of list) {
        if (!rawItem || typeof rawItem !== "object") continue;
        const origem = String(rawItem.origem || rawItem.source || req.headers["x-source"] || "Aplicativo Externo");
        const normalized = normalizeExternalProposal(rawItem, origem, rawItem.id ? String(rawItem.id) : undefined);
        if (!normalized.property.empreendimento || !normalized.property.unidade) continue;

        upsertProposalToBridgeDb(normalized, "external_api");
        const existingIdx = recentImportedProposals.findIndex(p => p.id === normalized.id);
        if (existingIdx !== -1) recentImportedProposals.splice(existingIdx, 1);
        recentImportedProposals.unshift(normalized);
        if (recentImportedProposals.length > 50) recentImportedProposals.pop();

        const newNotif = {
          id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          proposalId: normalized.id,
          origem,
          title: `Nova Proposta (${origem})`,
          message: `${normalized.property.empreendimento} - Unidade ${normalized.property.unidade} | ${normalized.customers?.[0]?.nome || "Comprador a Definir"}`,
          empreendimento: normalized.property.empreendimento,
          unidade: normalized.property.unidade,
          comprador: normalized.customers?.[0]?.nome || "A definir",
          valorTotal: normalized.valorTotalProposta,
          valorEntrada: normalized.valorEntrada,
          created_at: new Date().toISOString(),
          read: false,
          proposta: normalized
        };
        recentNotifications.unshift(newNotif);
        if (recentNotifications.length > 50) recentNotifications.pop();

        imported.push(normalized);
      }

      if (imported.length === 0) {
        return res.status(422).json({
          success: false,
          error: "Nenhuma proposta válida encontrada. Informe ao menos property.empreendimento e property.unidade."
        });
      }

      bridgeDb
        .prepare("INSERT INTO sync_logs (direction, endpoint, records_count, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("inbound", "/api/external/propostas", imported.length, "success", "POST", new Date().toISOString());

      res.status(201).json({
        success: true,
        importedCount: imported.length,
        proposta: imported[0],
        propostas: imported
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const handleExternalProposalUpdate = (req: express.Request, res: express.Response) => {
    const existing = bridgeDb.prepare("SELECT payload, synced_from FROM propostas WHERE id = ?").get(req.params.id) as { payload: string; synced_from: string } | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, error: "Proposta não encontrada." });
    }
    const current = JSON.parse(existing.payload);
    const updated = {
      ...current,
      ...(req.body || {}),
      id: current.id,
      updated_at: new Date().toISOString()
    };
    upsertProposalToBridgeDb(updated, existing.synced_from || "external_api");
    const qIdx = recentImportedProposals.findIndex(p => p.id === updated.id);
    if (qIdx !== -1) recentImportedProposals[qIdx] = updated;
    res.json({ success: true, proposta: updated });
  };

  app.put("/api/external/propostas/:id", requireExternalAppToken, handleExternalProposalUpdate);
  app.patch("/api/external/propostas/:id", requireExternalAppToken, handleExternalProposalUpdate);

  app.delete("/api/external/propostas/:id", requireExternalAppToken, (req, res) => {
    const result = bridgeDb.prepare("DELETE FROM propostas WHERE id = ?").run(req.params.id);
    const idx = recentImportedProposals.findIndex(p => p.id === req.params.id);
    if (idx !== -1) recentImportedProposals.splice(idx, 1);
    res.json({ success: true, deleted: result.changes > 0 });
  });

  app.get("/api/external/empreendimentos", requireExternalAppToken, (req, res) => {
    const rows = bridgeDb.prepare("SELECT payload FROM empreendimentos ORDER BY nome ASC").all() as Array<{ payload: string }>;
    const empreendimentos = rows.map(r => JSON.parse(r.payload));
    res.json({ success: true, count: empreendimentos.length, empreendimentos });
  });

  app.post("/api/external/empreendimentos", requireExternalAppToken, (req, res) => {
    const list = Array.isArray(req.body?.empreendimentos) ? req.body.empreendimentos : [req.body];
    const nowIso = new Date().toISOString();
    const stmt = bridgeDb.prepare(`
      INSERT INTO empreendimentos (id, payload, nome, status, updated_at)
      VALUES (@id, @payload, @nome, @status, @updated_at)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, nome = excluded.nome, status = excluded.status, updated_at = excluded.updated_at
    `);
    let count = 0;
    for (const emp of list) {
      if (!emp || !emp.nome) continue;
      const id = String(emp.id || `emp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
      const payload = { ...emp, id, updated_at: nowIso };
      stmt.run({ id, payload: JSON.stringify(payload), nome: String(emp.nome), status: String(emp.status || "ATIVO"), updated_at: nowIso });
      count++;
    }
    res.json({ success: true, count });
  });

  app.get("/api/external/cargos", requireExternalAppToken, (req, res) => {
    const rows = bridgeDb.prepare("SELECT payload FROM cargos ORDER BY nome ASC").all() as Array<{ payload: string }>;
    const cargos = rows.map(r => JSON.parse(r.payload));
    res.json({ success: true, count: cargos.length, cargos });
  });

  app.post("/api/external/cargos", requireExternalAppToken, (req, res) => {
    const list = Array.isArray(req.body?.cargos) ? req.body.cargos : [req.body];
    const nowIso = new Date().toISOString();
    const stmt = bridgeDb.prepare(`
      INSERT INTO cargos (id, payload, nome, cargo, email, updated_at)
      VALUES (@id, @payload, @nome, @cargo, @email, @updated_at)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, nome = excluded.nome, cargo = excluded.cargo, email = excluded.email, updated_at = excluded.updated_at
    `);
    let count = 0;
    for (const c of list) {
      if (!c || !c.nome) continue;
      const id = String(c.id || `cargo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`);
      const payload = { ...c, id, updated_at: nowIso };
      stmt.run({ id, payload: JSON.stringify(payload), nome: String(c.nome), cargo: String(c.cargo || ""), email: String(c.email || ""), updated_at: nowIso });
      count++;
    }
    res.json({ success: true, count });
  });

  app.get("/api/external/configuracoes-parcelas", requireExternalAppToken, (req, res) => {
    const rows = bridgeDb.prepare("SELECT payload FROM configuracoes_parcelas ORDER BY descricao ASC").all() as Array<{ payload: string }>;
    const configuracoes = rows.map(r => JSON.parse(r.payload));
    res.json({ success: true, count: configuracoes.length, configuracoes });
  });

  // ==========================================
  // Outbound Server-Side Proxy & Bridge Sync (/api/external-app/*)
  // Keeps EXTERNAL_APP_API_TOKEN strictly on the server
  // ==========================================
  app.get("/api/external-app/status", (req, res) => {
    const tokenConfigured = Boolean(getConfiguredExternalAppToken());
    const baseUrl = getConfiguredExternalAppUrl();
    const counts = {
      propostas: (bridgeDb.prepare("SELECT COUNT(*) as c FROM propostas").get() as any)?.c || 0,
      empreendimentos: (bridgeDb.prepare("SELECT COUNT(*) as c FROM empreendimentos").get() as any)?.c || 0,
      cargos: (bridgeDb.prepare("SELECT COUNT(*) as c FROM cargos").get() as any)?.c || 0,
      configuracoes_parcelas: (bridgeDb.prepare("SELECT COUNT(*) as c FROM configuracoes_parcelas").get() as any)?.c || 0,
    };
    const lastLog = bridgeDb.prepare("SELECT direction, endpoint, records_count, status, created_at FROM sync_logs ORDER BY id DESC LIMIT 1").get();
    res.json({
      success: true,
      tokenConfigured,
      baseUrlConfigured: Boolean(baseUrl),
      baseUrl: baseUrl || "",
      counts,
      lastSync: lastLog || null
    });
  });

  app.post("/api/external-app/bridge-sync", verifyFirebaseClientSession, (req, res) => {
    try {
      const { propostas, empreendimentos, cargos, configuracoes_parcelas } = req.body || {};
      const nowIso = new Date().toISOString();

      const tx = bridgeDb.transaction(() => {
        if (Array.isArray(propostas)) {
          for (const p of propostas) {
            if (p && p.id) upsertProposalToBridgeDb(p, "firestore");
          }
        }
        if (Array.isArray(empreendimentos)) {
          const empStmt = bridgeDb.prepare(`
            INSERT INTO empreendimentos (id, payload, nome, status, updated_at)
            VALUES (@id, @payload, @nome, @status, @updated_at)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, nome = excluded.nome, status = excluded.status, updated_at = excluded.updated_at
          `);
          for (const e of empreendimentos) {
            if (e && e.id) {
              empStmt.run({
                id: String(e.id),
                payload: JSON.stringify(e),
                nome: String(e.nome || ""),
                status: String(e.status || "ATIVO"),
                updated_at: nowIso
              });
            }
          }
        }
        if (Array.isArray(cargos)) {
          const cargoStmt = bridgeDb.prepare(`
            INSERT INTO cargos (id, payload, nome, cargo, email, updated_at)
            VALUES (@id, @payload, @nome, @cargo, @email, @updated_at)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, nome = excluded.nome, cargo = excluded.cargo, email = excluded.email, updated_at = excluded.updated_at
          `);
          for (const c of cargos) {
            if (c && c.id) {
              cargoStmt.run({
                id: String(c.id),
                payload: JSON.stringify(c),
                nome: String(c.nome || ""),
                cargo: String(c.cargo || ""),
                email: String(c.email || ""),
                updated_at: nowIso
              });
            }
          }
        }
        if (Array.isArray(configuracoes_parcelas)) {
          const cfgStmt = bridgeDb.prepare(`
            INSERT INTO configuracoes_parcelas (id, payload, descricao, updated_at)
            VALUES (@id, @payload, @descricao, @updated_at)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, descricao = excluded.descricao, updated_at = excluded.updated_at
          `);
          for (const cfg of configuracoes_parcelas) {
            if (cfg && cfg.id) {
              cfgStmt.run({
                id: String(cfg.id),
                payload: JSON.stringify(cfg),
                descricao: String(cfg.descricao || ""),
                updated_at: nowIso
              });
            }
          }
        }
      });

      tx();
      res.json({ success: true, syncedAt: nowIso });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/external-app/sync-from-remote", verifyFirebaseClientSession, async (req, res) => {
    const token = getConfiguredExternalAppToken();
    if (!token) {
      return res.status(400).json({
        success: false,
        error: "EXTERNAL_APP_API_TOKEN não está configurado nas variáveis de ambiente do servidor."
      });
    }

    const { url, endpoint = "/api/propostas", method = "GET", body, origem = "Aplicativo Externo" } = req.body || {};
    const baseUrl = getConfiguredExternalAppUrl();
    const targetUrl = (typeof url === "string" && url.trim())
      ? url.trim()
      : (baseUrl ? `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}` : "");

    if (!targetUrl || !isSafeExternalUrl(targetUrl)) {
      return res.status(400).json({
        success: false,
        error: "URL de destino inválida ou ausente. Configure EXTERNAL_APP_API_URL no ambiente ou informe uma URL HTTPS válida."
      });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(targetUrl, {
        method: String(method).toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Api-Key": token,
          "X-External-App-Token": token,
          "X-Webhook-Token": token
        },
        ...(body && String(method).toUpperCase() !== "GET" ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const text = await resp.text();
      let parsed: any = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        return res.status(resp.ok ? 502 : resp.status).json({
          success: false,
          error: `O aplicativo externo retornou resposta não-JSON (HTTP ${resp.status}).`,
          preview: text.slice(0, 300)
        });
      }

      if (!resp.ok) {
        return res.status(resp.status).json({
          success: false,
          error: parsed?.error || parsed?.message || `Erro HTTP ${resp.status} ao consultar aplicativo externo`,
          details: parsed
        });
      }

      const rawList = Array.isArray(parsed)
        ? parsed
        : (parsed.propostas || parsed.data || parsed.items || parsed.rows || (parsed.property ? [parsed] : []));

      const imported: any[] = [];
      for (const item of Array.isArray(rawList) ? rawList : []) {
        if (!item || typeof item !== "object") continue;
        const normalized = normalizeExternalProposal(item, String(item.origem || origem), item.id ? String(item.id) : undefined);
        if (!normalized.property.empreendimento || !normalized.property.unidade) continue;

        upsertProposalToBridgeDb(normalized, "external_sync");
        const existingIdx = recentImportedProposals.findIndex(p => p.id === normalized.id);
        if (existingIdx !== -1) {
          recentImportedProposals[existingIdx] = normalized;
        } else {
          recentImportedProposals.unshift(normalized);
        }
        imported.push(normalized);
      }
      if (recentImportedProposals.length > 50) {
        recentImportedProposals.length = 50;
      }

      bridgeDb
        .prepare("INSERT INTO sync_logs (direction, endpoint, records_count, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("pull", targetUrl, imported.length, "success", `HTTP ${resp.status}`, new Date().toISOString());

      res.json({
        success: true,
        totalFetched: Array.isArray(rawList) ? rawList.length : 0,
        importedCount: imported.length,
        propostas: imported,
        raw: imported.length === 0 ? parsed : undefined
      });
    } catch (err: any) {
      res.status(500).json({
        success: false,
        error: err.name === "AbortError" ? "Tempo limite esgotado ao conectar ao aplicativo externo." : err.message
      });
    }
  });

  app.post("/api/external-app/push-proposal", verifyFirebaseClientSession, async (req, res) => {
    const token = getConfiguredExternalAppToken();
    if (!token) {
      return res.status(400).json({
        success: false,
        error: "EXTERNAL_APP_API_TOKEN não está configurado nas variáveis de ambiente do servidor."
      });
    }

    const { url, endpoint = "/api/propostas", method = "POST", proposta } = req.body || {};
    const baseUrl = getConfiguredExternalAppUrl();
    const targetUrl = (typeof url === "string" && url.trim())
      ? url.trim()
      : (baseUrl ? `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}` : "");

    if (!targetUrl || !isSafeExternalUrl(targetUrl)) {
      return res.status(400).json({
        success: false,
        error: "URL de destino inválida ou ausente. Configure EXTERNAL_APP_API_URL no ambiente ou informe uma URL HTTPS válida."
      });
    }
    if (!proposta || typeof proposta !== "object") {
      return res.status(400).json({ success: false, error: "Payload 'proposta' ausente." });
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(targetUrl, {
        method: String(method).toUpperCase(),
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Api-Key": token,
          "X-External-App-Token": token,
          "X-Webhook-Token": token
        },
        body: JSON.stringify(proposta),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const text = await resp.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch {}

      bridgeDb
        .prepare("INSERT INTO sync_logs (direction, endpoint, records_count, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("push", targetUrl, 1, resp.ok ? "success" : "error", `HTTP ${resp.status}`, new Date().toISOString());

      res.status(resp.status).json({
        success: resp.ok,
        statusCode: resp.status,
        data: parsed
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // Clicksign Electronic Signature API v3 Routes
  // ==========================================
  const getClicksignToken = (): string => {
    let raw = (process.env.CLICKSIGN_ACCESS_TOKEN || "").trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1).trim();
    }
    raw = raw.replace(/^Bearer\s+/i, "").trim();
    return raw;
  };

  const getClicksignDefaultEnv = (): "sandbox" | "production" => {
    const raw = (process.env.CLICKSIGN_ENV || "").trim().toLowerCase();
    return raw === "production" || raw === "prod" ? "production" : "sandbox";
  };

  const resolveClicksignEnv = (requestedEnv?: unknown): "sandbox" | "production" => {
    const val = String(requestedEnv || "").trim().toLowerCase();
    if (val === "production" || val === "prod") return "production";
    if (val === "sandbox") return "sandbox";
    return getClicksignDefaultEnv();
  };

  const getClicksignApiBase = (env: "sandbox" | "production"): string =>
    env === "production"
      ? "https://app.clicksign.com/api/v3"
      : "https://sandbox.clicksign.com/api/v3";

  const getClicksignAppBase = (env: "sandbox" | "production"): string =>
    env === "production"
      ? "https://app.clicksign.com"
      : "https://sandbox.clicksign.com";

  const mapClicksignStatusPt = (rawStatus?: string): string => {
    const s = String(rawStatus || "").trim().toLowerCase();
    if (s === "draft") return "Rascunho";
    if (s === "running" || s === "in_progress") return "Em Andamento";
    if (s === "closed" || s === "finished" || s === "signed") return "Assinado";
    if (s === "canceled" || s === "cancelled") return "Cancelado";
    if (s === "refused" || s === "rejected") return "Recusado";
    if (s === "expired") return "Expirado";
    if (s === "pending" || s === "waiting") return "Pendente";
    return rawStatus || "Em Andamento";
  };

  const formatCpfCnpjForClicksign = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    const digits = String(raw).replace(/\D/g, "");
    if (digits.length === 11) {
      return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
    }
    if (digits.length === 14) {
      return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
    }
    return undefined;
  };

  const normalizePhoneForClicksign = (phone?: string): string | undefined => {
    if (!phone) return undefined;
    let digits = String(phone).replace(/\D/g, "");
    if (!digits) return undefined;
    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
      digits = digits.substring(2);
    }
    if (digits.length === 10 && ["7", "8", "9"].includes(digits.charAt(2))) {
      digits = digits.substring(0, 2) + "9" + digits.substring(2);
    }
    if (digits.length === 11 && digits.charAt(2) === "9") {
      const numberPart = digits.substring(2);
      if (/^(\d)\1+$/.test(numberPart) || numberPart === "900000000" || numberPart === "912345678") {
        return undefined;
      }
      return `+55${digits}`;
    }
    return undefined;
  };

  const sanitizeClicksignName = (rawName: string, defaultRole: string = "Signatário"): string => {
    let clean = String(rawName || "")
      .replace(/[^a-zA-ZÀ-ÿ\s\-_.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || clean.length < 2) {
      clean = defaultRole;
    }
    const parts = clean.split(" ");
    if (parts.length < 2) {
      clean = `${clean} ${defaultRole}`;
    }
    return clean;
  };

  const sanitizeClicksignEnvelopeName = (rawName: string): string => {
    let clean = String(rawName || "")
      .replace(/[^a-zA-Z0-9À-ÿ\s\-_.,()\[\]/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean || clean.length < 3) {
      clean = "Documento de Proposta e Contrato";
    }
    return clean.slice(0, 255);
  };

  const clicksignFetchJson = async (
    apiBase: string,
    token: string,
    endpointPath: string,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
    payload?: unknown
  ): Promise<any> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const resp = await fetch(`${apiBase}${endpointPath}`, {
        method,
        headers: {
          Authorization: token,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json"
        },
        ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal
      });
      const text = await resp.text();
      let parsed: any = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }
      if (!resp.ok) {
        const errorsList = Array.isArray(parsed?.errors) ? parsed.errors : [];
        const formattedDetails = errorsList.length > 0
          ? errorsList
              .map((e: any) => {
                const pointer = e?.source?.pointer ? ` (${e.source.pointer})` : "";
                return `${e?.detail || e?.title || JSON.stringify(e)}${pointer}`;
              })
              .join("; ")
          : (parsed?.error || parsed?.message || text?.slice(0, 300) || `HTTP ${resp.status}`);
        const err: any = new Error(formattedDetails);
        err.statusCode = resp.status;
        err.responseData = parsed;
        throw err;
      }
      return parsed;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const prepareUniqueSignersForClicksign = (signers: any[], cargos: any[] = []) => {
    const findCargo = (name?: string) => {
      if (!name || !Array.isArray(cargos) || cargos.length === 0) return undefined;
      const n = String(name).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (!n) return undefined;
      return cargos.find((c: any) => {
        const cn = (c.nome || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const ca = (c.apelido || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const cc = (c.cargo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
        const ce = (c.email || "").toLowerCase().trim();
        return cn === n || cn.includes(n) || n.includes(cn) || ca === n || cc === n || ce === n;
      });
    };

    const enriched: any[] = (signers || [])
      .map((s: any, idx: number) => {
        if (!s || !s.name || !String(s.name).trim()) return null;
        let name = String(s.name).trim();
        let email = s.email ? String(s.email).trim() : "";
        let phone = s.phone || s.whatsapp_phone_number || "";
        let cpf = s.cpf || "";
        const isWitness = (s.role || "").toLowerCase().includes("testemunha") || name.toLowerCase().includes("testemunha");

        let match = findCargo(name);
        if (!match && isWitness && !email && ["testemunha", "testemunha 1", "testemunha 2"].includes(name.toLowerCase())) {
          const witnessCargos = (cargos || []).filter((c: any) =>
            (c.cargo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes("testemunha")
          );
          const firstWitnessIdx = (signers || []).findIndex((item: any) => (item?.role || "").toLowerCase().includes("testemunha"));
          match = idx === firstWitnessIdx || name.toLowerCase().includes("1")
            ? witnessCargos[0]
            : witnessCargos[1];
        }

        if (match) {
          if (match.email && match.email.trim()) email = match.email.trim();
          if (match.nome && (!name || name.toLowerCase().includes("testemunha"))) name = match.nome.trim();
          if (!cpf && match.cpf_cnpj) cpf = match.cpf_cnpj.trim();
          if (!phone && match.telefone) phone = match.telefone.trim();
        }

        return { ...s, name, email, phone, cpf };
      })
      .filter(Boolean);

    const unique: any[] = [];
    const seenEmails = new Set<string>();
    const seenCpfs = new Set<string>();

    for (const s of enriched) {
      let email = s.email ? String(s.email).trim().toLowerCase() : "";
      let cpf = formatCpfCnpjForClicksign(s.cpf);
      const phone = normalizePhoneForClicksign(s.phone);
      const name = String(s.name || "").trim();
      const isWitness = (s.role || "").toLowerCase().includes("testemunha") || name.toLowerCase().includes("testemunha");

      if (!email) continue;

      if (seenEmails.has(email)) {
        if (isWitness) {
          const parts = email.split("@");
          if (parts.length === 2) {
            const baseUser = parts[0].split("+")[0];
            const cleanSlug = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "testemunha";
            let candidate = `${baseUser}+${cleanSlug}@${parts[1]}`;
            let seq = 2;
            while (seenEmails.has(candidate)) {
              candidate = `${baseUser}+${cleanSlug}${seq}@${parts[1]}`;
              seq++;
            }
            email = candidate;
          } else {
            continue;
          }
        } else {
          const existing = unique.find((u) => u.email === email);
          if (existing && s.role && existing.role && !existing.role.includes(s.role)) {
            existing.role = `${existing.role} / ${s.role}`;
          }
          continue;
        }
      }

      if (cpf && seenCpfs.has(cpf)) {
        cpf = undefined;
      }

      seenEmails.add(email);
      if (cpf) seenCpfs.add(cpf);
      unique.push({
        name: sanitizeClicksignName(name, isWitness ? "Testemunha" : "Signatário"),
        email,
        phone,
        cpf,
        role: s.role || (isWitness ? "Testemunha" : "Signatário"),
        isWitness
      });
    }

    return unique;
  };

  type ClicksignProbeResult = {
    validInProduction: boolean;
    validInSandbox: boolean;
    detectedEnvironment: "production" | "sandbox" | null;
    errorDetail?: string;
  };

  let clicksignProbeCache: { tokenHash: string; expiresAt: number; result: ClicksignProbeResult } | null = null;

  const probeClicksignEnvironment = async (
    envToCheck: "sandbox" | "production",
    token: string
  ): Promise<{ ok: boolean; status: number; detail?: string }> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(`${getClicksignApiBase(envToCheck)}/envelopes`, {
        method: "GET",
        headers: {
          Authorization: token,
          "Content-Type": "application/vnd.api+json",
          Accept: "application/vnd.api+json"
        },
        signal: controller.signal
      });
      if (resp.ok) {
        return { ok: true, status: resp.status };
      }
      const text = await resp.text().catch(() => "");
      let detail = `HTTP ${resp.status}`;
      try {
        const parsed = text ? JSON.parse(text) : null;
        if (Array.isArray(parsed?.errors) && parsed.errors[0]?.detail) {
          detail = parsed.errors[0].detail;
        } else if (parsed?.error || parsed?.message) {
          detail = parsed.error || parsed.message;
        }
      } catch {
        // ignore parse error
      }
      return { ok: false, status: resp.status, detail };
    } catch (e: any) {
      return { ok: false, status: 0, detail: e?.message || "Timeout ao consultar ClickSign" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const probeClicksignToken = async (token: string, forceRefresh = false): Promise<ClicksignProbeResult> => {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    if (!forceRefresh && clicksignProbeCache && clicksignProbeCache.tokenHash === tokenHash && Date.now() < clicksignProbeCache.expiresAt) {
      return clicksignProbeCache.result;
    }

    const [prodRes, sandboxRes] = await Promise.all([
      probeClicksignEnvironment("production", token),
      probeClicksignEnvironment("sandbox", token)
    ]);

    const validInProduction = prodRes.ok;
    const validInSandbox = sandboxRes.ok;
    let detectedEnvironment: "production" | "sandbox" | null = null;
    if (validInProduction && !validInSandbox) {
      detectedEnvironment = "production";
    } else if (validInSandbox && !validInProduction) {
      detectedEnvironment = "sandbox";
    } else if (validInProduction && validInSandbox) {
      detectedEnvironment = getClicksignDefaultEnv();
    }

    const result: ClicksignProbeResult = {
      validInProduction,
      validInSandbox,
      detectedEnvironment,
      ...(!detectedEnvironment ? { errorDetail: sandboxRes.detail || prodRes.detail || "Access Token inválido" } : {})
    };

    clicksignProbeCache = {
      tokenHash,
      expiresAt: Date.now() + 30000,
      result
    };
    return result;
  };

  app.get("/api/clicksign/config-status", verifyFirebaseClientSession, async (req, res) => {
    const token = getClicksignToken();
    const defaultEnvironment = getClicksignDefaultEnv();
    const forceRefresh = req.query.refresh === "1" || req.query.refresh === "true";

    if (!token) {
      return res.json({
        success: true,
        configured: false,
        tokenValid: false,
        detectedEnvironment: null,
        validInProduction: false,
        validInSandbox: false,
        defaultEnvironment,
        webhookPath: "/api/clicksign/webhook"
      });
    }

    const probe = await probeClicksignToken(token, forceRefresh);
    const tokenValid = Boolean(probe.detectedEnvironment);

    return res.json({
      success: true,
      configured: true,
      tokenValid,
      detectedEnvironment: probe.detectedEnvironment,
      validInProduction: probe.validInProduction,
      validInSandbox: probe.validInSandbox,
      defaultEnvironment: probe.detectedEnvironment || defaultEnvironment,
      validationMessage: tokenValid
        ? null
        : `O token configurado no servidor foi recusado pelo ClickSign (${probe.errorDetail || "Access Token inválido"}). Confirme se é um Access Token válido da API v3 com e-mail vinculado na aba API do ClickSign.`,
      webhookPath: "/api/clicksign/webhook"
    });
  });

  app.post("/api/clicksign/create-envelope", verifyFirebaseClientSession, async (req, res) => {
    const {
      documentBase64,
      documentName,
      envelopeName,
      signers,
      cargos,
      environment: reqEnv,
      simulationMode,
      deliveryChannel = "email",
      deadlineDays = 30,
      remindInterval = 3,
      message
    } = req.body || {};

    if (!documentBase64 || !Array.isArray(signers) || signers.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Parâmetros obrigatórios ausentes: documentBase64 e signers."
      });
    }

    const env = resolveClicksignEnv(reqEnv);
    const uniqueSigners = prepareUniqueSignersForClicksign(signers, cargos);

    if (uniqueSigners.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Nenhum signatário com e-mail válido encontrado. O ClickSign exige um e-mail para cada signatário."
      });
    }

    let safeDocName = (documentName && String(documentName).trim()) || "Contrato_Corretagem.pdf";
    safeDocName = safeDocName.replace(/[^a-zA-Z0-9._-]/g, "_");
    if (!safeDocName.toLowerCase().endsWith(".pdf")) {
      safeDocName += ".pdf";
    }

    const finalEnvelopeName = sanitizeClicksignEnvelopeName(
      (envelopeName && String(envelopeName).trim()) || safeDocName.replace(/\.pdf$/i, "").replace(/_/g, " ")
    );
    const token = getClicksignToken();

    if (simulationMode === true) {
      const envelopeId = `cs_sim_${crypto.randomUUID().slice(0, 12)}`;
      const documentId = `doc_sim_${crypto.randomUUID().slice(0, 10)}`;
      const appBase = getClicksignAppBase(env);
      const nowIso = new Date().toISOString();
      return res.json({
        success: true,
        provider: "clicksign",
        isSimulation: true,
        environment: env,
        envelopeId,
        documentId,
        documentName: safeDocName,
        envelopeName: finalEnvelopeName,
        status: "Em Andamento",
        rawStatus: "running",
        signers: uniqueSigners.map((s, idx) => ({
          id: `sig_sim_${idx}_${crypto.randomUUID().slice(0, 6)}`,
          name: s.name,
          email: s.email,
          phone: s.phone,
          cpf: s.cpf,
          role: s.role,
          status: "Pendente",
          signUrl: `${appBase}/sign/${envelopeId}/${idx}`
        })),
        viewUrl: `${appBase}/envelopes/${envelopeId}`,
        created_at: nowIso
      });
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        code: "CLICKSIGN_TOKEN_MISSING",
        error: "CLICKSIGN_ACCESS_TOKEN não configurado nas variáveis de ambiente do servidor.",
        details: "Defina CLICKSIGN_ACCESS_TOKEN no ambiente do servidor para disparar envelopes reais no ClickSign ou ative o Modo Simulação para testar."
      });
    }

    const apiBase = getClicksignApiBase(env);
    const appBase = getClicksignAppBase(env);

    try {
      const rawPdfBase64 = String(documentBase64).replace(/^data:[^;]+;base64,/, "").trim();
      const deadlineDate = new Date(Date.now() + Math.max(1, Number(deadlineDays) || 30) * 86400000);
      const deadlineIso = deadlineDate.toISOString();

      // 1. Criar Envelope (draft)
      const envResp = await clicksignFetchJson(apiBase, token, "/envelopes", "POST", {
        data: {
          type: "envelopes",
          attributes: {
            name: finalEnvelopeName.slice(0, 255),
            locale: "pt-BR",
            auto_close: true,
            remind_interval: Math.min(30, Math.max(1, Number(remindInterval) || 3)),
            block_after_refusal: true,
            deadline_at: deadlineIso
          }
        }
      });

      const envelopeId = envResp?.data?.id;
      if (!envelopeId) {
        throw new Error("ClickSign não retornou o ID do envelope criado.");
      }

      // 2. Adicionar Documento PDF
      const docResp = await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/documents`, "POST", {
        data: {
          type: "documents",
          attributes: {
            filename: safeDocName,
            content_base64: `data:application/pdf;base64,${rawPdfBase64}`
          }
        }
      });

      const documentId = docResp?.data?.id;
      if (!documentId) {
        throw new Error("ClickSign não retornou o ID do documento enviado.");
      }

      // 3. Criar Signatários e Requisitos (Qualificação + Autenticação)
      const createdSigners: any[] = [];
      for (const signer of uniqueSigners) {
        const useWhatsapp = deliveryChannel === "whatsapp" && Boolean(signer.phone);
        const notifyChannel = useWhatsapp ? "whatsapp" : "email";

        const signerAttributes: Record<string, any> = {
          name: signer.name,
          email: signer.email,
          communicate_events: {
            signature_request: notifyChannel,
            signature_reminder: notifyChannel,
            document_signed: "email"
          }
        };
        if (signer.phone) {
          signerAttributes.phone_number = signer.phone;
        }
        if (signer.cpf) {
          signerAttributes.documentation = signer.cpf;
          signerAttributes.has_documentation = true;
        } else {
          signerAttributes.has_documentation = false;
        }

        const signerResp = await clicksignFetchJson(
          apiBase,
          token,
          `/envelopes/${envelopeId}/signers`,
          "POST",
          {
            data: {
              type: "signers",
              attributes: signerAttributes
            }
          }
        );

        const signerId = signerResp?.data?.id;
        if (!signerId) {
          throw new Error(`ClickSign não retornou o ID do signatário ${signer.name}.`);
        }

        // 3a. Requisito de Qualificação (papel no documento)
        await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/requirements`, "POST", {
          data: {
            type: "requirements",
            attributes: {
              action: "agree",
              role: signer.isWitness ? "witness" : "sign"
            },
            relationships: {
              document: { data: { type: "documents", id: documentId } },
              signer: { data: { type: "signers", id: signerId } }
            }
          }
        });

        // 3b. Requisito de Autenticação
        await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/requirements`, "POST", {
          data: {
            type: "requirements",
            attributes: {
              action: "provide_evidence",
              auth: useWhatsapp ? "whatsapp" : "email"
            },
            relationships: {
              document: { data: { type: "documents", id: documentId } },
              signer: { data: { type: "signers", id: signerId } }
            }
          }
        });

        createdSigners.push({
          id: signerId,
          name: signer.name,
          email: signer.email,
          phone: signer.phone,
          cpf: signer.cpf,
          role: signer.role,
          status: "Pendente",
          signUrl: signerResp?.data?.links?.self || `${appBase}/envelopes/${envelopeId}`
        });
      }

      // 4. Ativar Envelope (status: running)
      const patchResp = await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}`, "PATCH", {
        data: {
          type: "envelopes",
          id: envelopeId,
          attributes: {
            status: "running"
          }
        }
      });

      // 5. Disparar notificações formais iniciais
      const notifyMsg = message && String(message).trim()
        ? String(message).trim()
        : `Olá! O documento "${finalEnvelopeName}" está disponível para sua assinatura eletrônica.`;
      try {
        await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/notifications`, "POST", {
          data: {
            type: "notifications",
            attributes: { message: notifyMsg }
          }
        });
      } catch (notifyErr: any) {
        console.warn("[ClickSign API] Notificação global retornou aviso, tentando por signatário:", notifyErr?.message);
        for (const cs of createdSigners) {
          try {
            await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/signers/${cs.id}/notifications`, "POST", {
              data: {
                type: "notifications",
                attributes: { message: notifyMsg }
              }
            });
          } catch {
            // envelope activation already triggers communicate_events automatically
          }
        }
      }

      const rawStatus = patchResp?.data?.attributes?.status || "running";
      return res.json({
        success: true,
        provider: "clicksign",
        isSimulation: false,
        environment: env,
        envelopeId,
        documentId,
        documentName: safeDocName,
        envelopeName: finalEnvelopeName,
        status: mapClicksignStatusPt(rawStatus),
        rawStatus,
        signers: createdSigners,
        viewUrl: `${appBase}/envelopes/${envelopeId}`,
        created_at: patchResp?.data?.attributes?.created || new Date().toISOString()
      });
    } catch (err: any) {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 400;
      console.warn(`[ClickSign API] Falha ao criar envelope (HTTP ${status}, env=${env}): ${err.message}`);

      if (status === 401) {
        const probe = await probeClicksignToken(token, true);
        if (probe.detectedEnvironment && probe.detectedEnvironment !== env) {
          const targetLabel = probe.detectedEnvironment === "production" ? "Produção" : "Sandbox";
          const currentLabel = env === "production" ? "Produção" : "Sandbox";
          return res.status(401).json({
            success: false,
            code: "CLICKSIGN_ENV_MISMATCH",
            suggestedEnvironment: probe.detectedEnvironment,
            error: `O token CLICKSIGN_ACCESS_TOKEN pertence ao ambiente de ${targetLabel}, mas o envio estava configurado para ${currentLabel}.`,
            details: `Ambiente ajustado para ${targetLabel}. Clique em enviar novamente.`
          });
        }
        return res.status(401).json({
          success: false,
          code: "CLICKSIGN_TOKEN_INVALID",
          error: "Access Token do ClickSign recusado pela API v3 (Sandbox e Produção).",
          details: "Verifique nas configurações > API da sua conta ClickSign se o token está ativo, pertence à API v3 e possui e-mail de usuário salvo/vinculado (ou ative o Modo Simulação para testes)."
        });
      }

      return res.status(status).json({
        success: false,
        error: "Erro ao criar envelope na API v3 do ClickSign.",
        details: err.message
      });
    }
  });

  app.get("/api/clicksign/status/:envelopeId", verifyFirebaseClientSession, async (req, res) => {
    const { envelopeId } = req.params;
    const { environment: reqEnv, isSimulation } = req.query;
    const env = resolveClicksignEnv(reqEnv);

    if (isSimulation === "true" || envelopeId.startsWith("cs_sim_")) {
      const lastEvent = bridgeDb
        .prepare("SELECT status, event_name, received_at FROM clicksign_events WHERE envelope_id = ? ORDER BY id DESC LIMIT 1")
        .get(envelopeId) as any;
      return res.json({
        success: true,
        isSimulation: true,
        environment: env,
        envelopeId,
        status: lastEvent?.status ? mapClicksignStatusPt(lastEvent.status) : "Em Andamento",
        rawStatus: lastEvent?.status || "running"
      });
    }

    const token = getClicksignToken();
    if (!token) {
      return res.status(400).json({
        success: false,
        code: "CLICKSIGN_TOKEN_MISSING",
        error: "CLICKSIGN_ACCESS_TOKEN não configurado no servidor."
      });
    }

    const apiBase = getClicksignApiBase(env);
    try {
      const [envResp, docsResp, signersResp] = await Promise.all([
        clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}`, "GET"),
        clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/documents`, "GET").catch(() => null),
        clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/signers`, "GET").catch(() => null)
      ]);

      const rawStatus = envResp?.data?.attributes?.status || "running";
      const firstDoc = Array.isArray(docsResp?.data) ? docsResp.data[0] : null;
      const docStatus = firstDoc?.attributes?.status;
      const signedDownloadUrl = firstDoc?.links?.files?.signed || firstDoc?.links?.files?.zipped || firstDoc?.links?.files?.original || undefined;

      const signersList = Array.isArray(signersResp?.data)
        ? signersResp.data.map((s: any) => {
            const attrs = s.attributes || {};
            const sStatus = attrs.status || (rawStatus === "closed" ? "signed" : "pending");
            return {
              id: s.id,
              name: attrs.name,
              email: attrs.email,
              phone: attrs.phone_number,
              cpf: attrs.documentation,
              status: mapClicksignStatusPt(sStatus),
              signUrl: s.links?.self
            };
          })
        : undefined;

      return res.json({
        success: true,
        isSimulation: false,
        environment: env,
        envelopeId,
        documentId: firstDoc?.id,
        status: mapClicksignStatusPt(rawStatus),
        rawStatus,
        docStatus,
        signedDownloadUrl,
        ...(signersList ? { signers: signersList } : {})
      });
    } catch (err: any) {
      const status = err.statusCode === 404 ? 404 : err.statusCode === 401 ? 401 : 500;
      return res.status(status).json({
        success: false,
        notFound: status === 404,
        unauthorized: status === 401,
        error: status === 404
          ? "Envelope não encontrado no ClickSign para o ambiente selecionado."
          : status === 401
          ? "Token CLICKSIGN_ACCESS_TOKEN inválido ou expirado."
          : err.message
      });
    }
  });

  app.post("/api/clicksign/notify/:envelopeId", verifyFirebaseClientSession, async (req, res) => {
    const { envelopeId } = req.params;
    const { environment: reqEnv, isSimulation, message, signerId } = req.body || {};
    const env = resolveClicksignEnv(reqEnv);

    if (isSimulation || envelopeId.startsWith("cs_sim_")) {
      return res.json({
        success: true,
        isSimulation: true,
        message: "Lembrete simulado enviado aos signatários pendentes."
      });
    }

    const token = getClicksignToken();
    if (!token) {
      return res.status(400).json({
        success: false,
        error: "CLICKSIGN_ACCESS_TOKEN não configurado no servidor."
      });
    }

    const apiBase = getClicksignApiBase(env);
    const notifyMsg = (message && String(message).trim()) || "Lembrete: há um documento aguardando sua assinatura eletrônica.";

    try {
      const endpoint = signerId
        ? `/envelopes/${envelopeId}/signers/${signerId}/notifications`
        : `/envelopes/${envelopeId}/notifications`;

      await clicksignFetchJson(apiBase, token, endpoint, "POST", {
        data: {
          type: "notifications",
          attributes: { message: notifyMsg }
        }
      });

      return res.json({
        success: true,
        message: "Notificação de assinatura reenviada pelo ClickSign!"
      });
    } catch (err: any) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: "Erro ao reenviar notificação no ClickSign.",
        details: err.message
      });
    }
  });

  app.post("/api/clicksign/cancel/:envelopeId", verifyFirebaseClientSession, async (req, res) => {
    const { envelopeId } = req.params;
    const { environment: reqEnv, isSimulation } = req.body || {};
    const env = resolveClicksignEnv(reqEnv);

    if (isSimulation || envelopeId.startsWith("cs_sim_")) {
      return res.json({
        success: true,
        isSimulation: true,
        status: "Cancelado",
        rawStatus: "canceled"
      });
    }

    const token = getClicksignToken();
    if (!token) {
      return res.status(400).json({
        success: false,
        error: "CLICKSIGN_ACCESS_TOKEN não configurado no servidor."
      });
    }

    const apiBase = getClicksignApiBase(env);
    try {
      await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}`, "PATCH", {
        data: {
          type: "envelopes",
          id: envelopeId,
          attributes: { status: "canceled" }
        }
      });
      return res.json({
        success: true,
        status: "Cancelado",
        rawStatus: "canceled"
      });
    } catch (err: any) {
      return res.status(err.statusCode || 400).json({
        success: false,
        error: "Erro ao cancelar envelope no ClickSign.",
        details: err.message
      });
    }
  });

  app.get("/api/clicksign/download/:envelopeId/:documentId", verifyFirebaseClientSession, async (req, res) => {
    const { envelopeId, documentId } = req.params;
    const { environment: reqEnv } = req.query;
    const env = resolveClicksignEnv(reqEnv);
    const token = getClicksignToken();

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "CLICKSIGN_ACCESS_TOKEN não configurado no servidor."
      });
    }

    const apiBase = getClicksignApiBase(env);
    try {
      const docResp = await clicksignFetchJson(apiBase, token, `/envelopes/${envelopeId}/documents/${documentId}`, "GET");
      const attrs = docResp?.data?.attributes || {};
      const links = docResp?.data?.links?.files || {};
      const targetUrl = links.signed || links.original;

      if (!targetUrl) {
        return res.status(404).json({
          success: false,
          error: "Link de download ainda não disponível no ClickSign para este documento."
        });
      }

      const fileResp = await fetch(targetUrl);
      if (!fileResp.ok) {
        throw new Error(`Falha ao baixar arquivo do ClickSign (HTTP ${fileResp.status})`);
      }

      const arrayBuffer = await fileResp.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const safeName = String(attrs.filename || `clicksign_${documentId}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("Content-Length", buffer.length);
      return res.send(buffer);
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({
        success: false,
        error: "Erro ao baixar documento do ClickSign.",
        details: err.message
      });
    }
  });

  app.post("/api/clicksign/webhook", (req: any, res) => {
    const secret = (process.env.CLICKSIGN_WEBHOOK_SECRET || "").trim();
    const signatureHeader = String(req.headers["content-hmac"] || "").trim();

    if (secret) {
      const rawBuffer = req.rawBody ? Buffer.from(req.rawBody) : Buffer.from(JSON.stringify(req.body || {}));
      const expectedHex = crypto.createHmac("sha256", secret).update(rawBuffer).digest("hex");
      const providedHex = signatureHeader.replace(/^sha256=/i, "").trim();
      if (!providedHex || !timingSafeTokenMatch(providedHex, expectedHex)) {
        return res.status(401).json({ success: false, error: "Assinatura Content-Hmac inválida." });
      }
    }

    const body = req.body || {};
    const eventName = body?.event?.name || body?.name || "webhook_event";
    const envelopeId =
      body?.event?.data?.envelope?.id ||
      body?.envelope?.id ||
      body?.document?.envelope_id ||
      body?.data?.id ||
      null;
    const documentId =
      body?.document?.key ||
      body?.document?.id ||
      body?.event?.data?.document?.id ||
      null;
    const status =
      body?.event?.data?.envelope?.status ||
      body?.document?.status ||
      body?.envelope?.status ||
      (eventName === "close" || eventName === "auto_close" ? "closed" : eventName === "cancel" ? "canceled" : "running");

    try {
      bridgeDb
        .prepare("INSERT INTO clicksign_events (envelope_id, document_id, event_name, status, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(
          envelopeId ? String(envelopeId) : null,
          documentId ? String(documentId) : null,
          String(eventName),
          String(status),
          JSON.stringify(body),
          new Date().toISOString()
        );
    } catch (dbErr) {
      console.error("[ClickSign Webhook] Erro ao gravar evento no SQLite:", dbErr);
    }

    res.json({ success: true, received: true });
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Catch-all handler for unmatched /api routes (prevents fallthrough to Vite SPA index.html)
  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `Rota de API não encontrada: ${req.method} ${req.path}` });
  });

  // Global Express error handler for API routes
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api") || req.url.startsWith("/api")) {
      console.error("[API Error Handler]", err);
      const statusCode = err.status || err.statusCode || 500;
      return res.status(statusCode).json({
        error: err.message || "Erro interno do servidor",
        code: err.code || "INTERNAL_SERVER_ERROR"
      });
    }
    next(err);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = fs.existsSync(path.join(process.cwd(), "dist", "index.html"))
      ? path.join(process.cwd(), "dist")
      : (fs.existsSync(path.join(_dirname, "index.html")) ? _dirname : path.join(_dirname, "dist"));

    console.log(`[Production] Servindo arquivos estáticos de: ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
