/**
 * Fixed shopper-facing hand-off lines, used when no LLM-written or
 * merchant-configured message is available.
 *
 * Honesty rules: never promise a response time ("shortly", "soon") and never
 * say someone is available when we don't know that. The only time figures
 * allowed come from data: the next opening of the channel's business hours and
 * the team's own median reply time (D5-7, see availabilityHandoffLine), and the
 * quick check's update timers, which the system enforces (D19, quickCheckCopy).
 */

export type HandoffCopyKey =
  /** Handed to the team; we don't know whether anyone is online. */
  | "handoffQueued"
  /** Within hours (or no schedule), nobody reachable: the team was alerted. */
  | "handoffNobodyOnline"
  /** Stale-message recovery gave up and handed the chat to the team. */
  | "recoveryEscalation"
  /** A change that needed a team member's OK got no decision in time (D4-8). */
  | "approvalExpired"
  /** A change was sent to a team member for approval this turn (D4-4). */
  | "approvalRequested"
  /** The AI is paused (owner, operator or agent off): sent once per conversation (D11-9). */
  | "pausedTeamWillReply"
  /** The organization is locked (billing or admin): sent once per conversation on non-web channels (D15-4). */
  | "suspendedHoldingReply";

type CopyLanguage = "en" | "pt" | "es";

function pickLanguage(languages: Array<string | null | undefined>): CopyLanguage {
  for (const language of languages) {
    const base = language?.toLowerCase().split(/[-_]/)[0];
    if (base && base in HANDOFF_COPY) return base as CopyLanguage;
  }
  return "en";
}

const HANDOFF_COPY: Record<CopyLanguage, Record<HandoffCopyKey, string>> = {
  en: {
    handoffQueued: "I've passed this to the team. They'll reply to you here in this chat.",
    handoffNobodyOnline:
      "No one from the team is online right now, so I've alerted them. They'll reply to you here in this chat.",
    recoveryEscalation:
      "Sorry, I ran into a problem with your message. I've passed it to the team, and they'll reply to you here in this chat.",
    approvalExpired:
      "The change you asked for needed a team member's OK, and it didn't come through in time, so it was not made. I've passed this to the team, and they'll reply to you here in this chat.",
    approvalRequested:
      "I've asked the team to approve this. It hasn't been done yet, and you'll get their answer here in this chat.",
    pausedTeamWillReply: "Thanks for your message. Our team will reply to you here in this chat.",
    suspendedHoldingReply: "Thanks for your message. We've received it.",
  },
  pt: {
    handoffQueued: "Encaminhei sua mensagem para a equipe. Eles vão te responder aqui neste chat.",
    handoffNobodyOnline:
      "Ninguém da equipe está online agora, então avisei a equipe. Eles vão te responder aqui neste chat.",
    recoveryEscalation:
      "Desculpe, tive um problema com a sua mensagem. Encaminhei para a equipe, e eles vão te responder aqui neste chat.",
    approvalExpired:
      "A alteração que você pediu precisava da aprovação de alguém da equipe, e ela não chegou a tempo, então não foi feita. Encaminhei para a equipe, e eles vão te responder aqui neste chat.",
    approvalRequested:
      "Pedi a aprovação da equipe. Isso ainda não foi feito, e você vai receber a resposta deles aqui neste chat.",
    pausedTeamWillReply:
      "Obrigado pela sua mensagem. Nossa equipe vai te responder aqui neste chat.",
    suspendedHoldingReply: "Obrigado pela sua mensagem. Nós a recebemos.",
  },
  es: {
    handoffQueued: "Le pasé tu mensaje al equipo. Te responderán aquí, en este chat.",
    handoffNobodyOnline:
      "Ahora mismo no hay nadie del equipo conectado, así que les avisé. Te responderán aquí, en este chat.",
    recoveryEscalation:
      "Lo siento, tuve un problema con tu mensaje. Se lo pasé al equipo y te responderán aquí, en este chat.",
    approvalExpired:
      "El cambio que pediste necesitaba la aprobación de alguien del equipo y no llegó a tiempo, así que no se hizo. Se lo pasé al equipo y te responderán aquí, en este chat.",
    approvalRequested:
      "Le pedí al equipo que lo apruebe. Todavía no está hecho y recibirás su respuesta aquí, en este chat.",
    pausedTeamWillReply: "Gracias por tu mensaje. Nuestro equipo te responderá aquí, en este chat.",
    suspendedHoldingReply: "Gracias por tu mensaje. Lo hemos recibido.",
  },
};

/**
 * Pick the line in the first language we have copy for, in priority order
 * (customer's detected language, conversation language, organization default).
 * Region tags are ignored ("pt-BR" uses "pt"). Falls back to English.
 */
export function handoffCopy(
  key: HandoffCopyKey,
  ...languages: Array<string | null | undefined>
): string {
  return HANDOFF_COPY[pickLanguage(languages)][key];
}

// ---------------------------------------------------------------------------
// Availability-aware hand-off line (D5-7)
// ---------------------------------------------------------------------------

export interface HandoffAvailability {
  state: "open" | "open_nobody_online" | "closed";
  nextOpening: Date | null;
  /** IANA zone of the channel's schedule (or the organization's). */
  timezone: string;
  /** The team's median first reply in minutes; null = not enough data. */
  typicalReplyMinutes: number | null;
}

const AVAILABILITY_COPY: Record<
  CopyLanguage,
  {
    alertedTypical: (wait: string) => string;
    closedUntil: (when: string) => string;
    closed: string;
    minutes: (n: number) => string;
    hours: (n: number) => string;
    today: (time: string) => string;
    tomorrow: (time: string) => string;
    weekday: (day: string, weekday: number, time: string) => string;
    date: (date: string, time: string) => string;
    zone: (city: string) => string;
  }
> = {
  en: {
    alertedTypical: (wait) =>
      `No one from the team is online right now, so I've alerted them. They usually reply within ${wait}, here in this chat.`,
    closedUntil: (when) =>
      `The team is away right now and back ${when}. I've passed your message on, and they'll reply to you here in this chat. Until then, I can keep helping with anything else.`,
    closed:
      "The team is away right now. I've passed your message on, and they'll reply to you here in this chat. Until then, I can keep helping with anything else.",
    minutes: (n) => (n === 1 ? "about a minute" : `about ${n} minutes`),
    hours: (n) => (n === 1 ? "about an hour" : `about ${n} hours`),
    today: (time) => `today at ${time}`,
    tomorrow: (time) => `tomorrow at ${time}`,
    weekday: (day, _weekday, time) => `on ${day} at ${time}`,
    date: (date, time) => `on ${date} at ${time}`,
    zone: (city) => `(${city} time)`,
  },
  pt: {
    alertedTypical: (wait) =>
      `Ninguém da equipe está online agora, então avisei a equipe. Eles costumam responder em ${wait}, aqui neste chat.`,
    closedUntil: (when) =>
      `A equipe não está atendendo agora e volta ${when}. Encaminhei sua mensagem, e eles vão te responder aqui neste chat. Até lá, posso continuar ajudando com qualquer outra coisa.`,
    closed:
      "A equipe não está atendendo agora. Encaminhei sua mensagem, e eles vão te responder aqui neste chat. Até lá, posso continuar ajudando com qualquer outra coisa.",
    minutes: (n) => (n === 1 ? "cerca de um minuto" : `cerca de ${n} minutos`),
    hours: (n) => (n === 1 ? "cerca de uma hora" : `cerca de ${n} horas`),
    today: (time) => `hoje às ${time}`,
    tomorrow: (time) => `amanhã às ${time}`,
    weekday: (day, weekday, time) =>
      `${weekday === 0 || weekday === 6 ? "no" : "na"} ${day} às ${time}`,
    date: (date, time) => `em ${date} às ${time}`,
    zone: (city) => `(horário de ${city})`,
  },
  es: {
    alertedTypical: (wait) =>
      `Ahora mismo no hay nadie del equipo conectado, así que les avisé. Suelen responder en ${wait}, aquí en este chat.`,
    closedUntil: (when) =>
      `El equipo no está disponible ahora y vuelve ${when}. Les pasé tu mensaje y te responderán aquí, en este chat. Mientras tanto, puedo seguir ayudándote con cualquier otra cosa.`,
    closed:
      "El equipo no está disponible ahora. Les pasé tu mensaje y te responderán aquí, en este chat. Mientras tanto, puedo seguir ayudándote con cualquier otra cosa.",
    minutes: (n) => (n === 1 ? "un minuto" : `unos ${n} minutos`),
    hours: (n) => (n === 1 ? "una hora" : `unas ${n} horas`),
    today: (time) => `hoy a las ${time}`,
    tomorrow: (time) => `mañana a las ${time}`,
    weekday: (day, _weekday, time) => `el ${day} a las ${time}`,
    date: (date, time) => `el ${date} a las ${time}`,
    zone: (city) => `(hora de ${city})`,
  },
};

const INTL_LOCALE: Record<CopyLanguage, string> = { en: "en-GB", pt: "pt-BR", es: "es-ES" };

/** "about 12 minutes" / "cerca de 2 horas". */
export function formatTypicalWait(minutes: number, ...languages: Array<string | null | undefined>) {
  const copy = AVAILABILITY_COPY[pickLanguage(languages)];
  return minutes < 60 ? copy.minutes(minutes) : copy.hours(Math.round(minutes / 60));
}

function localDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

/** "tomorrow at 09:00 (Lisbon time)", in the schedule's timezone. */
export function formatNextOpening(
  nextOpening: Date,
  timezone: string,
  now: Date,
  ...languages: Array<string | null | undefined>
): string {
  const language = pickLanguage(languages);
  const copy = AVAILABILITY_COPY[language];
  const locale = INTL_LOCALE[language];
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(nextOpening);
  const days = Math.round(
    (Date.parse(localDateKey(nextOpening, timezone)) - Date.parse(localDateKey(now, timezone))) /
      86_400_000,
  );
  let when: string;
  if (days <= 0) when = copy.today(time);
  else if (days === 1) when = copy.tomorrow(time);
  else if (days < 7) {
    const day = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long" }).format(
      nextOpening,
    );
    const weekday = new Date(`${localDateKey(nextOpening, timezone)}T12:00:00Z`).getUTCDay();
    when = copy.weekday(day, weekday, time);
  } else {
    const date = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      day: "numeric",
      month: "long",
    }).format(nextOpening);
    when = copy.date(date, time);
  }
  const city = (timezone.split("/").pop() ?? timezone).replace(/_/g, " ");
  return `${when} ${copy.zone(city)}`;
}

/**
 * The fixed hand-off line for the channel's availability: someone reachable,
 * nobody reachable within hours (team alerted, typical reply time when known),
 * or closed (back at the next opening; the AI keeps helping meanwhile).
 */
export function availabilityHandoffLine(
  availability: HandoffAvailability,
  now: Date,
  ...languages: Array<string | null | undefined>
): string {
  const language = pickLanguage(languages);
  const copy = AVAILABILITY_COPY[language];
  if (availability.state === "open") return HANDOFF_COPY[language].handoffQueued;
  if (availability.state === "open_nobody_online") {
    return availability.typicalReplyMinutes
      ? copy.alertedTypical(formatTypicalWait(availability.typicalReplyMinutes, language))
      : HANDOFF_COPY[language].handoffNobodyOnline;
  }
  return availability.nextOpening
    ? copy.closedUntil(
        formatNextOpening(availability.nextOpening, availability.timezone, now, language),
      )
    : copy.closed;
}

/** Facts for the merchant's own hand-off instructions (the planner gets these, not a guess). */
export function availabilityContext(availability: HandoffAvailability, now: Date): string {
  if (availability.state === "open") {
    return "Within business hours and a team member is reachable. The conversation is in the team's queue.";
  }
  if (availability.state === "open_nobody_online") {
    const wait = availability.typicalReplyMinutes
      ? ` The team usually replies within ${formatTypicalWait(availability.typicalReplyMinutes, "en")}.`
      : "";
    return `Within business hours, but no team member is online right now. The team has been alerted.${wait}`;
  }
  const back = availability.nextOpening
    ? ` The team is back ${formatNextOpening(availability.nextOpening, availability.timezone, now, "en")}.`
    : "";
  return `Outside business hours: no team member will reply until the team is back.${back} The conversation is in the team's queue. Keep helping the customer with anything else in the meantime; never invent another reason or time.`;
}

// ---------------------------------------------------------------------------
// Quick check with the team (D19)
// ---------------------------------------------------------------------------
//
// The only time figures here are the quick check's own timers, which the
// sweep enforces (an update, never an answer, is what is promised).

export interface QuickCheckCopy {
  /** T0, someone reachable: the AI keeps answering meanwhile. */
  asked: (minutes: number) => string;
  /** A second unknown fact while one question is open: added to it. */
  appended: string;
  /** T+5: still waiting; `minutes` until the wait ends. */
  stillChecking: (minutes: number) => string;
  /** T+10: in-chat channels (and web without a way to reach the shopper by email). */
  gaveUp: string;
  /** T+10 on web, the shopper left an email address (masked). */
  gaveUpEmail: (maskedEmail: string) => string;
  /** T+10 on web, no email: the widget shows its email form while the chat waits. */
  gaveUpLeaveEmail: string;
  /** T0, within hours but nobody reachable: straight to the team queue. */
  nobodyOnline: string;
  /** T0 outside business hours, with the next opening. */
  closedUntil: (when: string) => string;
  /** T0 outside business hours, next opening unknown. */
  closed: string;
}

const QUICK_CHECK_COPY: Record<CopyLanguage, QuickCheckCopy> = {
  en: {
    asked: (n) =>
      `I don't have that information. I'm checking with the team and will update you here within ${n === 1 ? "1 minute" : `${n} minutes`}. You can keep asking me other things meanwhile.`,
    appended:
      "I've added that to my question for the team. You can keep asking me other things meanwhile.",
    stillChecking: (n) =>
      `Still checking with the team. I'll update you here in about ${n === 1 ? "1 minute" : `${n} minutes`} either way.`,
    gaveUp:
      "I couldn't get that answer from the team yet. I've passed your question on, and they'll reply to you here in this chat.",
    gaveUpEmail: (email) =>
      `I couldn't get that answer from the team yet. I've passed your question on, and they'll reply to you here in this chat or by email at ${email}.`,
    gaveUpLeaveEmail:
      "I couldn't get that answer from the team yet. I've passed your question on. Leave your email below so the team can reply to you there.",
    nobodyOnline:
      "I don't have that information, and no one from the team is online right now. I've passed your question on, and they'll reply to you here in this chat.",
    closedUntil: (when) =>
      `I don't have that information, and the team is away right now, back ${when}. I've passed your question on, and they'll reply to you here in this chat. Until then, I can keep helping with anything else.`,
    closed:
      "I don't have that information, and the team is away right now. I've passed your question on, and they'll reply to you here in this chat. Until then, I can keep helping with anything else.",
  },
  pt: {
    asked: (n) =>
      `Não tenho essa informação. Estou verificando com a equipe e te dou um retorno aqui em até ${n === 1 ? "1 minuto" : `${n} minutos`}. Enquanto isso, pode me perguntar outras coisas.`,
    appended:
      "Incluí isso na minha pergunta para a equipe. Enquanto isso, pode me perguntar outras coisas.",
    stillChecking: (n) =>
      `Ainda estou verificando com a equipe. Em ${n === 1 ? "1 minuto" : `uns ${n} minutos`} te dou um retorno aqui, de qualquer forma.`,
    gaveUp:
      "Ainda não consegui essa resposta com a equipe. Encaminhei sua pergunta, e eles vão te responder aqui neste chat.",
    gaveUpEmail: (email) =>
      `Ainda não consegui essa resposta com a equipe. Encaminhei sua pergunta, e eles vão te responder aqui neste chat ou por e-mail em ${email}.`,
    gaveUpLeaveEmail:
      "Ainda não consegui essa resposta com a equipe. Encaminhei sua pergunta. Deixe seu e-mail abaixo para a equipe te responder por lá.",
    nobodyOnline:
      "Não tenho essa informação, e ninguém da equipe está online agora. Encaminhei sua pergunta, e eles vão te responder aqui neste chat.",
    closedUntil: (when) =>
      `Não tenho essa informação, e a equipe não está atendendo agora; ela volta ${when}. Encaminhei sua pergunta, e eles vão te responder aqui neste chat. Até lá, posso continuar ajudando com qualquer outra coisa.`,
    closed:
      "Não tenho essa informação, e a equipe não está atendendo agora. Encaminhei sua pergunta, e eles vão te responder aqui neste chat. Até lá, posso continuar ajudando com qualquer outra coisa.",
  },
  es: {
    asked: (n) =>
      `No tengo esa información. Lo estoy consultando con el equipo y te daré una respuesta aquí en un máximo de ${n === 1 ? "1 minuto" : `${n} minutos`}. Mientras tanto, puedes preguntarme otras cosas.`,
    appended:
      "Agregué eso a mi pregunta para el equipo. Mientras tanto, puedes preguntarme otras cosas.",
    stillChecking: (n) =>
      `Sigo consultándolo con el equipo. En ${n === 1 ? "1 minuto" : `unos ${n} minutos`} te daré una respuesta aquí, de todos modos.`,
    gaveUp:
      "Todavía no obtuve esa respuesta del equipo. Les pasé tu pregunta y te responderán aquí, en este chat.",
    gaveUpEmail: (email) =>
      `Todavía no obtuve esa respuesta del equipo. Les pasé tu pregunta y te responderán aquí, en este chat, o por correo en ${email}.`,
    gaveUpLeaveEmail:
      "Todavía no obtuve esa respuesta del equipo. Les pasé tu pregunta. Deja tu correo abajo para que el equipo te responda allí.",
    nobodyOnline:
      "No tengo esa información y ahora mismo no hay nadie del equipo conectado. Les pasé tu pregunta y te responderán aquí, en este chat.",
    closedUntil: (when) =>
      `No tengo esa información y el equipo no está disponible ahora; vuelve ${when}. Les pasé tu pregunta y te responderán aquí, en este chat. Mientras tanto, puedo seguir ayudándote con cualquier otra cosa.`,
    closed:
      "No tengo esa información y el equipo no está disponible ahora. Les pasé tu pregunta y te responderán aquí, en este chat. Mientras tanto, puedo seguir ayudándote con cualquier otra cosa.",
  },
};

/** Quick-check lines in the first language we have copy for (see handoffCopy). */
export function quickCheckCopy(...languages: Array<string | null | undefined>): QuickCheckCopy {
  return QUICK_CHECK_COPY[pickLanguage(languages)];
}

/** "r***@gmail.com": enough for the shopper to recognise, not to read off a screen. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * The T0 line for a quick check the team cannot take now (D19-12): outside
 * business hours with the next opening, or within hours with nobody reachable.
 */
export function quickCheckOfflineLine(
  availability: Pick<HandoffAvailability, "state" | "nextOpening" | "timezone">,
  now: Date,
  ...languages: Array<string | null | undefined>
): string {
  const copy = quickCheckCopy(...languages);
  if (availability.state !== "closed") return copy.nobodyOnline;
  return availability.nextOpening
    ? copy.closedUntil(
        formatNextOpening(availability.nextOpening, availability.timezone, now, ...languages),
      )
    : copy.closed;
}
