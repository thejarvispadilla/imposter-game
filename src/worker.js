const PAIRS = [
["Beach","Pool"],["Pizza","Lasagna"],["Sushi","Poke bowl"],["Burger","Hot dog"],
["Pancakes","Waffles"],["Taco","Burrito"],["Ice cream","Frozen yogurt"],["Coffee","Espresso"],
["Croissant","Bagel"],["Ramen","Pho"],["Gym","Yoga studio"],["Airport","Train station"],
["Hotel","Airbnb"],["Casino","Arcade"],["Library","Bookstore"],["Museum","Art gallery"],
["Cinema","Theater"],["Sauna","Hot tub"],["Surfing","Skateboarding"],["Camping","Glamping"],
["Hiking","Trail running"],["Poker","Blackjack"],["Karaoke","Concert"],["Fishing","Kayaking"],
["Skiing","Snowboarding"],["Golf","Mini golf"],["Guitar","Ukulele"],["iPhone","Android"],
["Laptop","Tablet"],["Sneakers","Sandals"],["Watch","Bracelet"],["Umbrella","Raincoat"],
["Candle","Incense"],["Dog","Wolf"],["Cat","Tiger"],["Dolphin","Shark"],
["Eagle","Hawk"],["Horse","Zebra"],["Bee","Wasp"],["Doctor","Nurse"],
["Pilot","Flight attendant"],["Chef","Baker"],["Teacher","Professor"],["Barista","Bartender"],
["Wine","Champagne"],["Beer","Cider"],["Whiskey","Rum"],["Smoothie","Milkshake"],
["Wedding","Prom"],["Birthday","New Year's Eve"],["Halloween","Costume party"],["Christmas","Thanksgiving"],
["Soccer","Rugby"],["Basketball","Volleyball"],["Tennis","Badminton"],["Boxing","Wrestling"],
["Paris","Rome"],["Vegas","Miami"],["Desert","Savanna"],["Waterfall","Geyser"],
["Submarine","Cruise ship"],["Helicopter","Hot air balloon"],["Tattoo","Piercing"],["Mustache","Beard"]
];
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function shuffle(a) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/create" && req.method === "POST") {
      const code = Array.from({ length: 4 }, () =>
        CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
      ).join("");
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      await stub.fetch("https://do/init", { method: "POST" });
      return Response.json({ code });
    }
    if (url.pathname === "/api/ws") {
      const code = (url.searchParams.get("code") || "").toUpperCase();
      if (!/^[A-Z2-9]{4}$/.test(code)) return new Response("bad code", { status: 400 });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(req);
    }
    return env.ASSETS.fetch(req);
  }
};

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = undefined;
  }

  async load() {
    if (this.room === undefined) {
      this.room = (await this.ctx.storage.get("room")) || null;
    }
  }
  async save() {
    await this.ctx.storage.put("room", this.room);
  }

  async fetch(req) {
    await this.load();
    const url = new URL(req.url);
    if (url.pathname === "/init") {
      if (!this.room) {
        this.room = {
          created: Date.now(), phase: "lobby", tellImposter: false,
          players: [], hostId: null, roundNum: 0, usedPairs: [], round: null
        };
        await this.save();
      }
      await this.ctx.storage.setAlarm(Date.now() + 1000 * 60 * 60 * 24);
      return new Response("ok");
    }
    if (req.headers.get("Upgrade") === "websocket") {
      if (!this.room) return new Response("no room", { status: 404 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("not found", { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
    this.room = null;
  }

  async webSocketMessage(ws, raw) {
    await this.load();
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!this.room) { try { ws.close(4404, "expired"); } catch {} return; }

    if (m.t === "join") {
      let p = m.pid && this.room.players.find(x => x.id === m.pid);
      if (!p) {
        const name = String(m.name || "").trim().slice(0, 16) || "Player " + (this.room.players.length + 1);
        p = { id: crypto.randomUUID(), name, score: 0, connected: true, inRound: false };
        this.room.players.push(p);
        if (!this.room.hostId) this.room.hostId = p.id;
      } else {
        p.connected = true;
        const name = String(m.name || "").trim().slice(0, 16);
        if (name) p.name = name;
      }
      ws.serializeAttachment({ pid: p.id });
      await this.ctx.storage.setAlarm(Date.now() + 1000 * 60 * 60 * 24);
      await this.save();
      this.broadcast();
      return;
    }

    const att = ws.deserializeAttachment ? ws.deserializeAttachment() : null;
    const pid = att && att.pid;
    if (!pid) return;
    const p = this.room.players.find(x => x.id === pid);
    if (!p) return;
    const isHost = pid === this.room.hostId;
    const r = this.room.round;

    switch (m.t) {
      case "toggleTell":
        if (isHost && this.room.phase === "lobby") this.room.tellImposter = !this.room.tellImposter;
        break;
      case "start":
        if (isHost && this.room.phase === "lobby") this.startRound();
        break;
      case "openVote":
        if (isHost && this.room.phase === "clue") this.room.phase = "vote";
        break;
      case "vote":
        if (this.room.phase === "vote" && r && p.inRound && !r.votes[pid] &&
            m.target !== pid && this.room.players.some(x => x.id === m.target && x.inRound)) {
          r.votes[pid] = m.target;
          const need = this.room.players.filter(x => x.inRound && x.connected).length;
          if (Object.keys(r.votes).length >= need) this.computeResult();
        }
        break;
      case "forceResult":
        if (isHost && this.room.phase === "vote" && r && Object.keys(r.votes).length > 0) this.computeResult();
        break;
      case "steal":
        if (isHost && this.room.phase === "result" && r && r.stealPending) {
          r.stealPending = false;
          r.stole = !!m.success;
          if (r.stole) r.deltas[r.imposterId] = (r.deltas[r.imposterId] || 0) + 2;
          this.applyDeltas();
        }
        break;
      case "next":
        if (isHost && this.room.phase === "result" && !(r && r.stealPending)) this.startRound();
        break;
    }
    await this.save();
    this.broadcast();
  }

  async webSocketClose(ws) { await this.markGone(ws); }
  async webSocketError(ws) { await this.markGone(ws); }

  async markGone(ws) {
    await this.load();
    if (!this.room) return;
    const att = ws.deserializeAttachment ? ws.deserializeAttachment() : null;
    const pid = att && att.pid;
    if (!pid) return;
    const stillOpen = this.ctx.getWebSockets().some(w => {
      if (w === ws) return false;
      const a = w.deserializeAttachment ? w.deserializeAttachment() : null;
      return a && a.pid === pid;
    });
    if (!stillOpen) {
      const p = this.room.players.find(x => x.id === pid);
      if (p) p.connected = false;
      await this.save();
      this.broadcast();
    }
  }

  startRound() {
    const room = this.room;
    const actives = room.players.filter(p => p.connected);
    if (actives.length < 3) return;
    room.players.forEach(p => { p.inRound = false; });
    actives.forEach(p => { p.inRound = true; });
    if (room.usedPairs.length >= PAIRS.length) room.usedPairs = [];
    let pi;
    do { pi = Math.floor(Math.random() * PAIRS.length); } while (room.usedPairs.includes(pi));
    room.usedPairs.push(pi);
    const flip = Math.random() < 0.5;
    const imposter = actives[Math.floor(Math.random() * actives.length)];
    room.roundNum++;
    room.round = {
      crewWord: flip ? PAIRS[pi][0] : PAIRS[pi][1],
      impWord: flip ? PAIRS[pi][1] : PAIRS[pi][0],
      imposterId: imposter.id,
      order: shuffle(actives.map(p => p.id)),
      votes: {}, accusedId: null, caught: false, stole: false,
      stealPending: false, deltas: {}, applied: false
    };
    room.phase = "clue";
  }

  computeResult() {
    const r = this.room.round;
    const tally = {};
    for (const t of Object.values(r.votes)) tally[t] = (tally[t] || 0) + 1;
    let max = 0, top = [];
    for (const [id, n] of Object.entries(tally)) {
      if (n > max) { max = n; top = [id]; }
      else if (n === max) top.push(id);
    }
    r.accusedId = top.length === 1 ? top[0] : null;
    r.caught = r.accusedId === r.imposterId;
    r.deltas = {};
    for (const [voter, target] of Object.entries(r.votes)) {
      if (target === r.imposterId) r.deltas[voter] = (r.deltas[voter] || 0) + 1;
    }
    if (!r.caught) {
      r.deltas[r.imposterId] = (r.deltas[r.imposterId] || 0) + 3;
      r.stealPending = false;
      this.applyDeltas();
    } else {
      r.stealPending = true;
    }
    this.room.phase = "result";
  }

  applyDeltas() {
    const r = this.room.round;
    if (r.applied) return;
    r.applied = true;
    for (const [id, d] of Object.entries(r.deltas)) {
      const p = this.room.players.find(x => x.id === id);
      if (p) p.score += d;
    }
  }

  broadcast() {
    const room = this.room;
    if (!room) return;
    const r = room.round;
    const pub = {
      phase: room.phase, roundNum: room.roundNum, tellImposter: room.tellImposter, hostId: room.hostId,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score, connected: p.connected, inRound: p.inRound }))
    };
    if (r) {
      pub.order = r.order;
      if (room.phase === "vote") {
        pub.votesIn = Object.keys(r.votes).length;
        pub.votesNeed = room.players.filter(x => x.inRound && x.connected).length;
        pub.voted = Object.keys(r.votes);
      }
      if (room.phase === "result") {
        pub.result = {
          imposterId: r.imposterId, accusedId: r.accusedId, caught: r.caught,
          stole: r.stole, stealPending: r.stealPending,
          crewWord: r.crewWord, impWord: r.impWord, deltas: r.deltas
        };
      }
    }
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment ? ws.deserializeAttachment() : null;
      const pid = att && att.pid;
      if (!pid) continue;
      const p = room.players.find(x => x.id === pid);
      if (!p) continue;
      const you = {
        id: p.id, isHost: pid === room.hostId, inRound: p.inRound,
        votedFor: (r && r.votes[pid]) || null
      };
      if (r && p.inRound && (room.phase === "clue" || room.phase === "vote")) {
        you.word = pid === r.imposterId ? r.impWord : r.crewWord;
        if (room.tellImposter && pid === r.imposterId) you.imposter = true;
      }
      try { ws.send(JSON.stringify({ t: "state", pub, you })); } catch {}
    }
  }
}
