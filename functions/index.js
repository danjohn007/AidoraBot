import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { defineSecret } from "firebase-functions/params";
import axios from "axios";

const VERIFY_TOKEN = defineSecret("VERIFY_TOKEN_AIDORABOT");
const WHATSAPP_TOKEN = defineSecret("WHATSAPP_TOKEN_AIDORABOT");
const WHATSAPP_PHONE_NUMBER_ID = defineSecret("WHATSAPP_PHONE_NUMBER_ID_AIDORABOT");
const WEB_ADMIN_KEY = defineSecret("WEB_ADMIN_KEY_AIDORABOT");

const TEMPLATE_NAME = "aidora_plantilla";
const TEMPLATE_LANGUAGE = "es_MX";
const GRAPH_VERSION = "v25.0";
const API_URL = "https://crmcamaradecomercio.com.mx/aidora/bot-api.php";

const ZONES = [
  ["zone_qro", "Querétaro"],
  ["zone_corregidora", "Corregidora"],
  ["zone_marques", "El Marqués"],
  ["zone_sma", "San Miguel de Allende"],
  ["zone_other", "Otra"],
];
const EDUCATION = [
  ["edu_primary", "Primaria"], ["edu_secondary", "Secundaria"],
  ["edu_high", "Bachillerato"], ["edu_technical", "Carrera técnica"],
  ["edu_degree", "Licenciatura"], ["edu_postgrad", "Posgrado"], ["edu_other", "Otro"],
];
const TRAINING = [
  ["train_child", "Puericultura"], ["train_nursing", "Enfermería"],
  ["train_gerontology", "Gerontología"], ["train_physio", "Fisioterapia"],
  ["train_psychology", "Psicología"], ["train_elder", "Cuidados adulto mayor"],
  ["train_firstaid", "Primeros auxilios"], ["train_other", "Otra"],
  ["train_none", "Sin formación especial"],
];
const EXPERIENCE = [
  ["exp_none", "Sin experiencia"], ["exp_lt1", "Menos de 1 año"],
  ["exp_1_2", "1–2 años"], ["exp_3_5", "3–5 años"], ["exp_gt5", "Más de 5 años"],
];
const ACTIVITIES = [
  "Acompañamiento", "Higiene y cuidado personal", "Alimentación", "Movilidad y traslado",
  "Administración de medicamentos", "Cuidados postoperatorios", "Personas con movilidad reducida",
  "Personas con enfermedades crónicas", "Acompañamiento a consultas", "Actividades recreativas",
  "Supervisión", "Otro",
];
const SERVICE_TYPES = [
  "4 horas", "6 horas", "8 horas", "12 horas", "Más de 12 horas",
  "Turnos nocturnos", "Fines de semana", "Eventos", "Disponibilidad variable",
];
const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function normalizePhone(v = "") { return String(v).replace(/\D/g, ""); }
function normalizeText(v = "") { return String(v).trim(); }
function optionValue(list, id) { return list.find(([key]) => key === id)?.[1] || null; }
function extractReply(msg) {
  if (msg?.type === "interactive") {
    const i = msg.interactive || {};
    if (i.button_reply) return { id: i.button_reply.id, text: i.button_reply.title || i.button_reply.id };
    if (i.list_reply) return { id: i.list_reply.id, text: i.list_reply.title || i.list_reply.id };
  }
  if (msg?.type === "text") return { id: null, text: msg.text?.body || "" };
  return { id: null, text: "" };
}
function parseMultiNumbers(text, options) {
  const nums = [...new Set(String(text).match(/\d+/g)?.map(Number) || [])];
  if (!nums.length || nums.some((n) => n < 1 || n > options.length)) return null;
  return nums.map((n) => options[n - 1]);
}
function statusLabel(s) {
  return ({ nueva: "Nueva / recibida", en_revision: "En revisión", contactado: "Contactado", aprobado: "Aprobado", no_aprobado: "No aprobado" })[s] || s || "Recibida";
}

async function api(action, payload, key) {
  const { data } = await axios.post(API_URL, { action, ...payload }, {
    headers: { "Content-Type": "application/json", "x-admin-key": key }, timeout: 15000,
  });
  return data;
}
async function sendGraph(payload, token, phoneNumberId) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const { data } = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20000,
  });
  return data;
}
async function logInteraction(ctx, key, { direction, type, messageId, step, content, raw, status }) {
  try {
    await api("log", {
      whatsapp: ctx.whatsapp,
      contact_id: ctx.contactId,
      conversation_id: ctx.conversationId,
      direction, type, message_id: messageId || null, step, content, raw, status,
    }, key);
  } catch (e) { logger.warn("Aidora log error", e?.response?.data || e?.message); }
}
async function sendText(ctx, text, cfg, step = ctx.step) {
  const r = await sendGraph({ messaging_product: "whatsapp", to: ctx.whatsapp, type: "text", text: { body: text } }, cfg.token, cfg.phoneId);
  await logInteraction(ctx, cfg.key, { direction: "saliente", type: "texto", messageId: r?.messages?.[0]?.id, step, content: text, status: "aceptado_meta" });
  return r;
}
async function sendButtons(ctx, body, buttons, cfg, step = ctx.step) {
  const r = await sendGraph({
    messaging_product: "whatsapp", to: ctx.whatsapp, type: "interactive",
    interactive: {
      type: "button", body: { text: body },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
    },
  }, cfg.token, cfg.phoneId);
  await logInteraction(ctx, cfg.key, { direction: "saliente", type: "interactivo", messageId: r?.messages?.[0]?.id, step, content: body, status: "aceptado_meta" });
  return r;
}
async function sendList(ctx, body, button, rows, cfg, step = ctx.step) {
  const r = await sendGraph({
    messaging_product: "whatsapp", to: ctx.whatsapp, type: "interactive",
    interactive: {
      type: "list", body: { text: body },
      action: {
        button: button.slice(0, 20),
        sections: [{ title: "Opciones", rows: rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description ? { description: r.description.slice(0, 72) } : {}) })) }],
      },
    },
  }, cfg.token, cfg.phoneId);
  await logInteraction(ctx, cfg.key, { direction: "saliente", type: "interactivo", messageId: r?.messages?.[0]?.id, step, content: body, status: "aceptado_meta" });
  return r;
}
async function saveSession(ctx, step, data, cfg) {
  ctx.step = step;
  await api("session_save", { whatsapp: ctx.whatsapp, step, data }, cfg.key);
}
async function clearSession(ctx, cfg) {
  ctx.step = "menu";
  await api("session_clear", { whatsapp: ctx.whatsapp }, cfg.key);
}
async function showMainMenu(ctx, cfg, includeWelcome = false) {
  if (includeWelcome) {
    await sendText(ctx,
      "💙 ¡Hola! Bienvenido(a) a Aidora.\n\nNos alegra que quieras formar parte de nuestro equipo de Aidores y acompañar a adultos mayores con respeto, empatía y profesionalismo.\n\nEn Aidora buscamos personas comprometidas con brindar cuidado, compañía y atención de calidad en casa.",
      cfg, "menu");
  }
  await sendList(ctx, "¿Qué deseas hacer?", "Ver opciones", [
    { id: "main_register", title: "Quiero ser Aidor(a)", description: "Inicia tu registro para formar parte de Aidora" },
    { id: "main_info", title: "Conocer cómo funciona", description: "Conoce qué significa ser Aidor(a)" },
    { id: "main_status", title: "Ya hice mi registro", description: "Consulta el estado de tu registro" },
    { id: "main_advisor", title: "Hablar con un asesor", description: "Solicita contacto del equipo Aidora" },
  ], cfg, "menu_choice");
  await saveSession(ctx, "menu_choice", {}, cfg);
}
async function startRegistration(ctx, cfg) {
  const data = { whatsapp: ctx.whatsapp };
  await sendText(ctx,
    "🩵 Un Aidor(a) es una persona que brinda acompañamiento y cuidado en casa de acuerdo con las necesidades de cada adulto mayor.\n\nEn Aidora contamos con diferentes niveles de servicio y buscamos asignar a cada familia el perfil adecuado.",
    cfg, "profile");
  await sendList(ctx, "¿Con cuál perfil consideras que se relaciona mejor tu experiencia?", "Elegir perfil", [
    { id: "profile_basic", title: "Aidor Básico", description: "Acompañamiento, supervisión y actividades cotidianas" },
    { id: "profile_nurse", title: "Aidor Enfermero", description: "Cuidados de enfermería y mayor supervisión" },
    { id: "profile_special", title: "Aidor Especialista", description: "Experiencia y preparación específica" },
    { id: "profile_unsure", title: "No estoy seguro(a)", description: "Aidora revisará tu experiencia" },
  ], cfg, "profile");
  await saveSession(ctx, "profile", data, cfg);
}
async function showInfo(ctx, cfg) {
  await sendText(ctx,
    "ℹ️ ¿Qué significa ser Aidor(a)?\n\nUn Aidor(a) brinda acompañamiento y cuidado en casa según las necesidades de cada adulto mayor.\n\n🩵 Aidor Básico\nAcompañamiento, supervisión, compañía y apoyo en actividades cotidianas.\n\n💙 Aidor Enfermero\nApoyo en cuidados de enfermería y necesidades que requieren mayor supervisión.\n\n💜 Aidor Especialista\nProfesionales con experiencia y preparación específica para determinadas necesidades de cuidado.",
    cfg, "info");
  await sendButtons(ctx, "¿Qué deseas hacer ahora?", [
    { id: "main_register", title: "Iniciar registro" },
    { id: "main_advisor", title: "Hablar con asesor" },
    { id: "back_menu", title: "Menú principal" },
  ], cfg, "info_choice");
  await saveSession(ctx, "info_choice", {}, cfg);
}
async function requestAdvisor(ctx, cfg, origin = "menu_principal") {
  await api("save_advisor_request", { whatsapp: ctx.whatsapp, origin }, cfg.key);
  await sendButtons(ctx,
    "💬 Hemos registrado tu solicitud. El equipo de Aidora podrá contactarte al número de WhatsApp desde el que nos escribes.",
    [{ id: "back_menu", title: "Menú principal" }], cfg, "advisor_done");
  await saveSession(ctx, "advisor_done", {}, cfg);
}
async function showStatus(ctx, cfg) {
  const r = await api("latest_registration", { whatsapp: ctx.whatsapp }, cfg.key);
  if (!r?.application) {
    await sendButtons(ctx,
      "📋 No encontramos un registro previo asociado a este número de WhatsApp.",
      [{ id: "main_register", title: "Iniciar registro" }, { id: "back_menu", title: "Menú principal" }], cfg, "status");
  } else {
    const a = r.application;
    await sendButtons(ctx,
      `📋 Encontramos tu registro.\n\nNombre: ${a.nombre_completo}\nPerfil: ${a.perfil_interes || "Por definir"}\nEstado: ${statusLabel(a.estado)}\nFecha: ${a.creado_en}`,
      [{ id: "back_menu", title: "Menú principal" }, { id: "main_advisor", title: "Hablar con asesor" }], cfg, "status");
  }
  await saveSession(ctx, "status", {}, cfg);
}
function numberedPrompt(title, options) {
  return `${title}\n\n${options.map((v, i) => `${i + 1}.- ${v}`).join("\n")}\n\nEscribe los números separados por comas. Ejemplo: 1, 3, 5`;
}

export const whatsappWebhookAidoraBot = onRequest({
  cors: true,
  region: "us-central1",
  secrets: [VERIFY_TOKEN, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WEB_ADMIN_KEY],
}, async (req, res) => {
  const cfg = {
    verify: VERIFY_TOKEN.value(), token: WHATSAPP_TOKEN.value(),
    phoneId: WHATSAPP_PHONE_NUMBER_ID.value(), key: WEB_ADMIN_KEY.value(),
  };

  if (req.method === "GET") {
    const mode = req.query["hub.mode"], token = req.query["hub.verify_token"], challenge = req.query["hub.challenge"];
    return mode === "subscribe" && token === cfg.verify ? res.status(200).send(challenge) : res.sendStatus(403);
  }

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (Array.isArray(value?.statuses) && value.statuses.length) {
      for (const s of value.statuses) {
        try { await api("message_status", { message_id: s.id, status: s.status, detail: s.errors || null }, cfg.key); } catch (e) { logger.warn("Aidora status sync", e?.message); }
      }
      return res.sendStatus(200);
    }

    const msg = value?.messages?.[0];
    const from = normalizePhone(msg?.from || "");
    if (!msg || !from) return res.sendStatus(200);

    const boot = await api("bootstrap", { whatsapp: from }, cfg.key);
    const ctx = {
      whatsapp: from,
      contactId: Number(boot?.contact?.id_contacto || 0),
      conversationId: Number(boot?.conversation?.id_conversacion || 0),
      step: boot?.session?.step || "menu",
    };
    let data = boot?.session?.data && typeof boot.session.data === "object" ? boot.session.data : {};
    const reply = extractReply(msg);
    const text = normalizeText(reply.text);
    const lower = text.toLowerCase();

    await logInteraction(ctx, cfg.key, {
      direction: "entrante", type: msg.type || "otro", messageId: msg.id,
      step: ctx.step, content: text || reply.id || msg.type, raw: msg, status: "recibido",
    });

    if (["menu", "menú", "inicio", "reiniciar"].includes(lower) || reply.id === "back_menu") {
      await clearSession(ctx, cfg);
      await showMainMenu(ctx, cfg, false);
      return res.sendStatus(200);
    }

    if (reply.id === "main_register") { await startRegistration(ctx, cfg); return res.sendStatus(200); }
    if (reply.id === "main_info") { await showInfo(ctx, cfg); return res.sendStatus(200); }
    if (reply.id === "main_status") { await showStatus(ctx, cfg); return res.sendStatus(200); }
    if (reply.id === "main_advisor") { await requestAdvisor(ctx, cfg, ctx.step); return res.sendStatus(200); }

    if (ctx.step === "menu" || ctx.step === "menu_choice") {
      await showMainMenu(ctx, cfg, ctx.step === "menu");
      return res.sendStatus(200);
    }

    if (ctx.step === "profile") {
      const profiles = { profile_basic: "Aidor Básico", profile_nurse: "Aidor Enfermero", profile_special: "Aidor Especialista", profile_unsure: "No estoy seguro(a)" };
      if (!profiles[reply.id]) { await startRegistration(ctx, cfg); return res.sendStatus(200); }
      data.perfil_interes = profiles[reply.id];
      await saveSession(ctx, "name", data, cfg);
      await sendText(ctx, "📋 Para comenzar tu registro, necesitamos algunos datos.\n\n¿Cuál es tu nombre completo?", cfg, "name");
      return res.sendStatus(200);
    }

    if (ctx.step === "name") {
      if (text.length < 3) { await sendText(ctx, "Escribe tu nombre completo, por favor.", cfg); return res.sendStatus(200); }
      data.nombre_completo = text;
      await saveSession(ctx, "age", data, cfg);
      await sendText(ctx, "¿Cuál es tu edad?", cfg, "age");
      return res.sendStatus(200);
    }

    if (ctx.step === "age") {
      const age = Number(text.replace(/\D/g, ""));
      if (!Number.isInteger(age) || age < 1 || age > 120) { await sendText(ctx, "Indica tu edad usando solo números. Ejemplo: 35", cfg); return res.sendStatus(200); }
      data.edad = age;
      await saveSession(ctx, "phone", data, cfg);
      await sendText(ctx, "📞 ¿Cuál es tu teléfono de contacto?\n\nSi deseas usar el mismo número de este WhatsApp, escribe *MISMO*.", cfg, "phone");
      return res.sendStatus(200);
    }

    if (ctx.step === "phone") {
      const phone = lower === "mismo" ? from : normalizePhone(text);
      if (phone.length < 10) { await sendText(ctx, "Escribe un teléfono válido de al menos 10 dígitos o responde MISMO.", cfg); return res.sendStatus(200); }
      data.telefono_contacto = phone;
      data.whatsapp = from;
      await saveSession(ctx, "email", data, cfg);
      await sendText(ctx, "📧 ¿Cuál es tu correo electrónico?", cfg, "email");
      return res.sendStatus(200);
    }

    if (ctx.step === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) { await sendText(ctx, "Escribe un correo válido. Ejemplo: nombre@correo.com", cfg); return res.sendStatus(200); }
      data.correo = text;
      await saveSession(ctx, "city", data, cfg);
      await sendText(ctx, "📍 ¿En qué ciudad vives?", cfg, "city");
      return res.sendStatus(200);
    }

    if (ctx.step === "city") {
      if (text.length < 2) { await sendText(ctx, "Indica la ciudad donde vives.", cfg); return res.sendStatus(200); }
      data.ciudad = text;
      await saveSession(ctx, "zone", data, cfg);
      await sendList(ctx, "¿En qué zona puedes prestar el servicio?", "Elegir zona", ZONES.map(([id,title])=>({id,title})), cfg, "zone");
      return res.sendStatus(200);
    }

    if (ctx.step === "zone") {
      const zone = optionValue(ZONES, reply.id);
      if (!zone) { await sendList(ctx, "Selecciona una zona de la lista.", "Elegir zona", ZONES.map(([id,title])=>({id,title})), cfg); return res.sendStatus(200); }
      if (reply.id === "zone_other") {
        await saveSession(ctx, "zone_other", data, cfg);
        await sendText(ctx, "Escribe la zona donde puedes prestar el servicio.", cfg, "zone_other");
      } else {
        data.zona_servicio = zone;
        await saveSession(ctx, "education", data, cfg);
        await sendList(ctx, "🎓 ¿Cuál es tu nivel de estudios?", "Elegir estudios", EDUCATION.map(([id,title])=>({id,title})), cfg, "education");
      }
      return res.sendStatus(200);
    }

    if (ctx.step === "zone_other") {
      if (text.length < 2) { await sendText(ctx, "Escribe la zona donde puedes prestar el servicio.", cfg); return res.sendStatus(200); }
      data.zona_servicio = text;
      await saveSession(ctx, "education", data, cfg);
      await sendList(ctx, "🎓 ¿Cuál es tu nivel de estudios?", "Elegir estudios", EDUCATION.map(([id,title])=>({id,title})), cfg, "education");
      return res.sendStatus(200);
    }

    if (ctx.step === "education") {
      const v = optionValue(EDUCATION, reply.id);
      if (!v) { await sendList(ctx, "Selecciona tu nivel de estudios.", "Elegir estudios", EDUCATION.map(([id,title])=>({id,title})), cfg); return res.sendStatus(200); }
      data.nivel_estudios = v;
      await saveSession(ctx, "training", data, cfg);
      await sendList(ctx, "¿Tienes formación relacionada con el cuidado?", "Elegir formación", TRAINING.map(([id,title])=>({id,title})), cfg, "training");
      return res.sendStatus(200);
    }

    if (ctx.step === "training") {
      const v = optionValue(TRAINING, reply.id);
      if (!v) { await sendList(ctx, "Selecciona una opción de formación.", "Elegir formación", TRAINING.map(([id,title])=>({id,title})), cfg); return res.sendStatus(200); }
      data.formacion_cuidado = v;
      await saveSession(ctx, "experience", data, cfg);
      await sendList(ctx, "¿Cuántos años de experiencia tienes cuidando adultos mayores?", "Elegir experiencia", EXPERIENCE.map(([id,title])=>({id,title})), cfg, "experience");
      return res.sendStatus(200);
    }

    if (ctx.step === "experience") {
      const v = optionValue(EXPERIENCE, reply.id);
      if (!v) { await sendList(ctx, "Selecciona tus años de experiencia.", "Elegir experiencia", EXPERIENCE.map(([id,title])=>({id,title})), cfg); return res.sendStatus(200); }
      data.experiencia_anios = v;
      await saveSession(ctx, "activities", data, cfg);
      await sendText(ctx, numberedPrompt("🧩 ¿En qué actividades tienes experiencia? Puedes elegir varias.", ACTIVITIES), cfg, "activities");
      return res.sendStatus(200);
    }

    if (ctx.step === "activities") {
      const selected = parseMultiNumbers(text, ACTIVITIES);
      if (!selected) { await sendText(ctx, numberedPrompt("Selecciona una o varias actividades válidas.", ACTIVITIES), cfg); return res.sendStatus(200); }
      data.actividades_experiencia = selected.join(", ");
      await saveSession(ctx, "service_types", data, cfg);
      await sendText(ctx, numberedPrompt("🕐 ¿Qué tipo de servicio puedes realizar? Puedes elegir varias opciones.", SERVICE_TYPES), cfg, "service_types");
      return res.sendStatus(200);
    }

    if (ctx.step === "service_types") {
      const selected = parseMultiNumbers(text, SERVICE_TYPES);
      if (!selected) { await sendText(ctx, numberedPrompt("Selecciona una o varias opciones válidas.", SERVICE_TYPES), cfg); return res.sendStatus(200); }
      data.tipos_servicio = selected.join(", ");
      await saveSession(ctx, "days", data, cfg);
      await sendText(ctx, numberedPrompt("📅 ¿Qué días puedes trabajar? Puedes elegir varios.", DAYS), cfg, "days");
      return res.sendStatus(200);
    }

    if (ctx.step === "days") {
      const selected = parseMultiNumbers(text, DAYS);
      if (!selected) { await sendText(ctx, numberedPrompt("Selecciona uno o varios días válidos.", DAYS), cfg); return res.sendStatus(200); }
      data.dias_disponibles = selected.join(", ");
      await saveSession(ctx, "mobility", data, cfg);
      await sendButtons(ctx, "🚗 ¿Tienes posibilidad de trasladarte a diferentes zonas para realizar tus servicios?", [
        { id: "mob_yes", title: "Sí" }, { id: "mob_no", title: "No" }, { id: "mob_depends", title: "Depende ubicación" },
      ], cfg, "mobility");
      return res.sendStatus(200);
    }

    if (ctx.step === "mobility") {
      const mv = { mob_yes: "Sí", mob_no: "No", mob_depends: "Depende de la ubicación" }[reply.id];
      if (!mv) { await sendButtons(ctx, "Selecciona una opción de movilidad.", [{ id:"mob_yes",title:"Sí"},{ id:"mob_no",title:"No"},{ id:"mob_depends",title:"Depende ubicación"}], cfg); return res.sendStatus(200); }
      data.movilidad = mv;
      if (reply.id === "mob_yes") {
        await saveSession(ctx, "distance", data, cfg);
        await sendText(ctx, "¿Hasta qué distancia aproximadamente puedes trasladarte?", cfg, "distance");
      } else {
        data.distancia_traslado = null;
        await saveSession(ctx, "motivation", data, cfg);
        await sendText(ctx, "❤️ En Aidora creemos que cuidar también significa acompañar.\n\n¿Por qué te gustaría formar parte del equipo Aidora?", cfg, "motivation");
      }
      return res.sendStatus(200);
    }

    if (ctx.step === "distance") {
      if (!text) { await sendText(ctx, "Indica aproximadamente hasta qué distancia puedes trasladarte.", cfg); return res.sendStatus(200); }
      data.distancia_traslado = text;
      await saveSession(ctx, "motivation", data, cfg);
      await sendText(ctx, "❤️ En Aidora creemos que cuidar también significa acompañar.\n\n¿Por qué te gustaría formar parte del equipo Aidora?", cfg, "motivation");
      return res.sendStatus(200);
    }

    if (ctx.step === "motivation") {
      if (text.length < 3) { await sendText(ctx, "Cuéntanos brevemente por qué te gustaría formar parte de Aidora.", cfg); return res.sendStatus(200); }
      data.motivacion = text;
      await saveSession(ctx, "care_meaning", data, cfg);
      await sendText(ctx, "¿Qué significa para ti cuidar a un adulto mayor?", cfg, "care_meaning");
      return res.sendStatus(200);
    }

    if (ctx.step === "care_meaning") {
      if (text.length < 3) { await sendText(ctx, "Cuéntanos brevemente qué significa para ti cuidar a un adulto mayor.", cfg); return res.sendStatus(200); }
      data.significado_cuidar = text;
      data.whatsapp = from;
      const saved = await api("save_application", { whatsapp: from, data }, cfg.key);
      await sendButtons(ctx,
        `💙 ¡Gracias por compartir tu información!\n\nHemos recibido tu registro${saved?.id_solicitud ? ` #${saved.id_solicitud}` : ""}.\n\nNuestro equipo revisará tu información, experiencia y disponibilidad para determinar el perfil Aidora que corresponda.\n\nEn Aidora no buscamos solamente personas que sepan cuidar. Buscamos personas que sepan acompañar.\n\nSi tienes vocación de servicio, compromiso y empatía, queremos conocerte.`,
        [{ id: "back_menu", title: "Menú principal" }], cfg, "registro_completo");
      return res.sendStatus(200);
    }

    await showMainMenu(ctx, cfg, false);
    return res.sendStatus(200);
  } catch (err) {
    logger.error("Aidora webhook error", err?.response?.data || err?.stack || err?.message || err);
    try {
      const value = req.body?.entry?.[0]?.changes?.[0]?.value;
      const from = normalizePhone(value?.messages?.[0]?.from || "");
      if (from) await sendGraph({ messaging_product:"whatsapp",to:from,type:"text",text:{body:"Tuvimos un inconveniente al procesar tu respuesta. Por favor escribe *MENÚ* para continuar."}}, cfg.token, cfg.phoneId);
    } catch {}
    return res.sendStatus(200);
  }
});

async function sendAidoraTemplate({ to, message, token, phoneNumberId }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  const { data } = await axios.post(url, {
    messaging_product: "whatsapp", to: normalizePhone(to), type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: TEMPLATE_LANGUAGE },
      components: [{ type: "body", parameters: [{ type: "text", text: String(message || "").trim() }] }],
    },
  }, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, timeout: 20000 });
  return data;
}

export const crmSendAidora = onRequest({
  cors: true, region: "us-central1", secrets: [WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WEB_ADMIN_KEY],
}, async (req, res) => {
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const key = req.get("x-admin-key") || req.body?.admin_key || "";
  if (!key || key !== WEB_ADMIN_KEY.value()) return res.status(401).json({ error: "No autorizado" });
  const to = normalizePhone(req.body?.to || "");
  const message = String(req.body?.message || "").trim();
  if (!to) return res.status(400).json({ error: "Falta el número de WhatsApp" });
  if (!message) return res.status(400).json({ error: "Falta el mensaje para {{1}}" });
  try {
    const data = await sendAidoraTemplate({ to, message, token: WHATSAPP_TOKEN.value(), phoneNumberId: WHATSAPP_PHONE_NUMBER_ID.value() });
    const messageId = data?.messages?.[0]?.id || null;
    logger.info("Aidora CRM template accepted", { to, messageId, template: TEMPLATE_NAME });
    return res.status(200).json({ ok: true, message_id: messageId, template: TEMPLATE_NAME, language: TEMPLATE_LANGUAGE });
  } catch (err) {
    const detail = err?.response?.data || { message: err?.message || "Error desconocido" };
    logger.error("Aidora CRM send error", detail);
    return res.status(err?.response?.status || 500).json({ error: detail?.error?.message || detail?.message || "No se pudo enviar", detail });
  }
});
