/**
 * 同词相遇 · 联机服务端
 * 纯 Node，零依赖：静态文件 + SSE 推送 + 房间状态机
 * 启动：node server.js  (默认 8099)
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8099);
const ROOT = __dirname;
const ROOM_TTL = 1000 * 60 * 60 * 4;      // 空房间保留 4 小时
const RESULT_PAUSE = 2400;                 // 揭晓停留多久后进下一轮

const rooms = new Map();                   // code -> room
const streams = new Map();                 // code -> Set<{res,pid}>

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8"
};

/* ---------------- 工具 ---------------- */
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function code4() {
  let s = "";
  for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}
const norm = s => String(s || "").replace(/[\s，。,.、！!？?；;：:"'“”‘’（）()《》【】\-—_]/g, "").toLowerCase();

function send(res, status, body, headers = {}) {
  res.writeHead(status, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, headers));
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });
}

/* ---------------- 房间 ---------------- */
function makeRoom(code, limit) {
  return {
    code, players: [], round: 1, prev: null, picks: {}, history: [],
    phase: "waiting", result: null, limit: limit > 0 ? limit : 0,
    deadline: 0, timer: null, createdAt: Date.now()
  };
}

function startRound(room) {
  room.phase = "playing";
  room.picks = {};
  room.result = null;
  room.deadline = room.limit ? Date.now() + room.limit * 1000 : 0;
  clearTimeout(room.timer);
  if (room.limit) {
    room.timer = setTimeout(() => {
      if (room.phase !== "playing") return;
      room.phase = "done";
      room.result = { a: "", b: "", hit: false, timeout: true };
      broadcast(room.code);
      closeRoomTimer(room);
    }, room.limit * 1000);
  }
  broadcast(room.code);
}

function closeRoomTimer(room) {
  clearTimeout(room.timer);
  room.timer = null;
}

function trySettle(room) {
  if (room.players.length < 2) return;
  const [p1, p2] = room.players;
  if (room.picks[p1.pid] == null || room.picks[p2.pid] == null) return;

  const a = room.picks[p1.pid], b = room.picks[p2.pid];
  const hit = norm(a) === norm(b);
  room.result = { a, b, hit };
  room.history.push([a, b]);
  room.phase = "result";
  closeRoomTimer(room);
  broadcast(room.code);

  if (hit) {
    setTimeout(() => {
      if (!rooms.has(room.code)) return;
      room.phase = "done";
      broadcast(room.code);
    }, 900);
  } else {
    setTimeout(() => {
      if (!rooms.has(room.code) || room.phase !== "result") return;
      room.prev = [a, b];
      room.round += 1;
      startRound(room);
    }, RESULT_PAUSE);
  }
}

function stateFor(room, pid) {
  const self = room.players.find(p => p.pid === pid) || null;
  const opp = room.players.find(p => p.pid !== pid) || null;
  const reveal = room.phase !== "playing" && room.phase !== "waiting";
  return {
    room: room.code,
    you: pid,
    joined: room.players.length,
    hasOpp: !!opp,
    round: room.round,
    phase: room.phase,
    limit: room.limit,
    deadline: room.deadline,
    prev: room.prev,
    history: room.history,
    selfPick: self ? (room.picks[pid] ?? null) : null,
    oppSubmitted: opp ? room.picks[opp.pid] != null : false,
    result: reveal ? room.result : null,
    serverNow: Date.now()
  };
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  const set = streams.get(code);
  if (!set) return;
  for (const s of set) {
    try {
      s.res.write(`data: ${JSON.stringify(stateFor(room, s.pid))}\n\n`);
    } catch { /* 断线由 close 处理 */ }
  }
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return send(res, 403, "forbidden");
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, "not found");
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

/* ---------------- HTTP ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const p = u.pathname;

  if (req.method === "GET" && p === "/events") {
    const code = (u.searchParams.get("room") || "").toUpperCase();
    const pid = u.searchParams.get("pid") || "";
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: "room-not-found" });

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 2000\n\n");
    res.write(`data: ${JSON.stringify(stateFor(room, pid))}\n\n`);

    if (!streams.has(code)) streams.set(code, new Set());
    const entry = { res, pid };
    streams.get(code).add(entry);

    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { } }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      const set = streams.get(code);
      if (set) { set.delete(entry); if (!set.size) streams.delete(code); }
    });
    return;
  }

  if (req.method === "POST" && p === "/api/join") {
    const body = await readBody(req);
    const pid = String(body.pid || "").slice(0, 40);
    if (!pid) return send(res, 400, { error: "no-pid" });

    let code = String(body.room || "").toUpperCase().trim();
    let room;

    if (body.create) {
      do { code = code4(); } while (rooms.has(code));
      room = makeRoom(code, Number(body.limit) || 0);
      rooms.set(code, room);
    } else {
      room = rooms.get(code);
      if (!room) return send(res, 404, { error: "room-not-found" });
      if (room.players.length >= 2 && !room.players.some(x => x.pid === pid)) {
        return send(res, 409, { error: "room-full" });
      }
      if (room.phase !== "waiting" && !room.players.some(x => x.pid === pid)) {
        return send(res, 409, { error: "game-started" });
      }
    }

    if (!room.players.some(x => x.pid === pid)) room.players.push({ pid, at: Date.now() });

    if (room.players.length === 2 && room.phase === "waiting") {
      startRound(room);
    } else {
      broadcast(code);
    }
    return send(res, 200, { room: code, pid, phase: room.phase });
  }

  if (req.method === "POST" && p === "/api/submit") {
    const body = await readBody(req);
    const code = String(body.room || "").toUpperCase();
    const pid = String(body.pid || "");
    const word = String(body.word || "").trim().slice(0, 12);
    const room = rooms.get(code);
    if (!room) return send(res, 404, { error: "room-not-found" });
    if (room.phase !== "playing") return send(res, 409, { error: "not-playing" });
    if (!room.players.some(x => x.pid === pid)) return send(res, 403, { error: "not-in-room" });
    if (!word) return send(res, 400, { error: "empty" });
    if (room.picks[pid] != null) return send(res, 409, { error: "already" });

    room.picks[pid] = word;
    broadcast(code);
    trySettle(room);
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && p === "/api/testlog") {
    let d = "";
    req.on("data", c => { d += c; });
    req.on("end", () => { console.log("[testlog]\n" + d); send(res, 200, { ok: true }); });
    return;
  }

  if (req.method === "GET" && p === "/api/health") {
    return send(res, 200, { ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
  }

  if (req.method === "GET") return serveStatic(req, res, p);
  return send(res, 404, { error: "not-found" });
});

/* ---------------- 清扫 ---------------- */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const empty = !streams.has(code) || streams.get(code).size === 0;
    if (empty && now - room.createdAt > ROOM_TTL) {
      closeRoomTimer(room);
      rooms.delete(code);
    }
  }
}, 60000);

server.listen(PORT, () => console.log(`[same-word] listening on http://127.0.0.1:${PORT}`));
