const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const venom = require("venom-bot");
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

const APP_PORT = process.env.PORT || 3000;
const SHARED_TOKEN = process.env.BRIDGE_TOKEN || "troque-isto";
const INCOMING_WEBHOOK =
  process.env.INCOMING_WEBHOOK || "http://localhost/whatsapp/webhook.php";

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "10mb" }));

let client = null;
let qrBase64 = null;

venom
  .create(
    {
      session: "sessao-principal",
      headless: true,
      multidevice: true,
    },
    (base64Qr) => {
      qrBase64 = base64Qr; // atualiza o QR para login
    }
  )
  .then((c) => {
    client = c;
    console.log("Venom pronto");
    listenIncoming();
  })
  .catch((e) => console.error("Erro Venom", e));

function auth(req, res, next) {
  const t = req.headers["x-bridge-token"];
  if (t !== SHARED_TOKEN)
    return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/qr", auth, (req, res) => {
  if (!qrBase64) return res.json({ status: "ok", message: "aguardando QR" });
  res.json({ status: "ok", qr: qrBase64 });
});

app.post("/send", auth, async (req, res) => {
  try {
    const { to, message } = req.body;
    if (!to || !message)
      return res.status(400).json({ error: "to e message são obrigatórios" });
    const jid = normaliza(to);
    const r = await client.sendText(jid, message);
    res.json({ status: "sent", result: r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/send-media", auth, async (req, res) => {
  try {
    const { to, fileBase64, filename, caption } = req.body;
    if (!to || !fileBase64 || !filename)
      return res
        .status(400)
        .json({ error: "campos obrigatórios: to, fileBase64, filename" });
    const jid = normaliza(to);
    const r = await client.sendFileFromBase64(
      jid,
      fileBase64,
      filename,
      caption || ""
    );
    res.json({ status: "sent", result: r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function normaliza(num) {
  // Aceita “+5534999999999” ou “34999999999”; devolve JID
  const only = String(num).replace(/\D/g, "");
  return only.endsWith("@c.us") || only.endsWith("@s.whatsapp.net")
    ? only
    : `${only}@c.us`;
}

function listenIncoming() {
  client.onMessage(async (msg) => {
    // Encaminha mensagem recebida para teu PHP (atendimento/hub)
    try {
      await fetch(INCOMING_WEBHOOK, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Bridge-Token": SHARED_TOKEN,
        },
        body: JSON.stringify({
          from: msg.from,
          to: msg.to,
          body: msg.body,
          type: msg.type,
          isGroupMsg: msg.isGroupMsg,
          timestamp: msg.timestamp,
        }),
      });
    } catch (e) {
      console.error("Falha webhook PHP", e.message);
    }
  });
}

app.listen(APP_PORT, () => console.log("Bridge rodando na porta", APP_PORT));
