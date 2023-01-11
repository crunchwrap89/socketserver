const httpServer = require("http").createServer();
const { createClient } = require("ioredis");
const { createAdapter } = require("@socket.io/redis-adapter");
const config = require("./config.js")
const io = require("socket.io")(httpServer, { cors: {
    origin: function (origin, callback) {
      if (config.ORIGINS.indexOf(origin) !== -1) {
        callback(null, true)
      } else {
        callback(new Error('Not allowed by CORS'))
      }}}});


const pubClient = createClient({ host: config.HOST, port: 6379 });
const subClient = pubClient.duplicate();

pubClient.on('error', function (e) {
  console.log(`Error connecting to redis with PUBCLIENT: "${e}"`);
  if (e.message === 'ERR invalid password') {
    console.log(`Fatal error occurred "${e.message}". Stopping server.`);
    throw e; // Fatal error, don't attempt to fix
  }
});

subClient.on('error', function (e) {
  console.log(`Error connecting to redis with SUBCLIENT: "${e}"`);
  if (e.message === 'ERR invalid password') {
    console.log(`Fatal error occurred "${e.message}". Stopping server.`);
    throw e; // Fatal error, don't attempt to fix
  }
});

io.adapter(createAdapter(pubClient, subClient));

const { setupWorker } = require("@socket.io/sticky");
const crypto = require("crypto");
const randomId = () => crypto.randomBytes(8).toString("hex");

const { RedisSessionStore } = require("./sessionStore");
const sessionStore = new RedisSessionStore(pubClient, subClient);

const { RedisMessageStore } = require("./messageStore");
const messageStore = new RedisMessageStore(pubClient, subClient);

io.use(async (socket, next) => {
  const sessionID = socket.handshake.auth.username;
  let latitd = socket.handshake.auth.latitd;
  let longitd = socket.handshake.auth.longitd;
  if (sessionID) {
    const session = await sessionStore.findSession(sessionID);
    if (session) {
      socket.sessionID = sessionID;
      socket.userID = session.userID;
      socket.username = session.username;
      socket.latitd = latitd;
      socket.longitd = longitd;
      return next();
    }
  }
  if (!sessionID) {
    return next(new Error("invalid username"));
  }
  //if user has not logged in before but username is Ok, run below.
  socket.sessionID = sessionID;
  socket.userID = randomId();
  socket.username = sessionID;
  socket.latitd = latitd;
  socket.longitd = longitd;
  next();
});

io.on("connection", async (socket) => {
  // persist session
  sessionStore.saveSession(socket.sessionID, {
    userID: socket.userID,
    username: socket.username,
    connected: true,
    latitd: socket.latitd,
    longitd: socket.longitd,
  });

  // emit session details
  socket.emit("session", {
    sessionID: socket.sessionID,
    userID: socket.userID,
  });

  // join the "userID" room
  socket.join(socket.userID);

  // fetch existing users
  const users = [];
  const [messages, sessions] = await Promise.all([
    messageStore.findMessagesForUser(socket.userID),
    sessionStore.findAllSessions(),
  ]);
  const messagesPerUser = new Map();
  messages.forEach((message) => {
    const { from, to } = message;
    const otherUser = socket.userID === from ? to : from;
    if (messagesPerUser.has(otherUser)) {
      messagesPerUser.get(otherUser).push(message);
    } else {
      messagesPerUser.set(otherUser, [message]);
    }
  });

  sessions.forEach((session) => {
    users.push({
      userID: session.userID,
      username: session.username,
      latitd: session.latitd,
      longitd: session.longitd,
      connected: session.connected,
      messages: messagesPerUser.get(session.userID) || [],
    });
  });
  socket.emit("users", users);

  // notify existing users
  socket.broadcast.emit("user connected", {
    userID: socket.userID,
    username: socket.username,
    latitd: socket.latitd,
    longitd: socket.longitd,
    connected: true,
    messages: [],
  });

  // forward the private message to the right recipient (and to other tabs of the sender)
  socket.on("private message", ({ content, to }) => {
    const message = {
      content,
      from: socket.userID,
      to,
    };
    socket.to(to).to(socket.userID).emit("private message", message);
    messageStore.saveMessage(message);
  });

    // update the connected users current location in multiplayer
    socket.on("update position", ({ lat, lng }) => {
      socket.latitd = lat;
      socket.longitd = lng;
      // update the connection status of the session
      sessionStore.saveSession(socket.sessionID, {
        userID: socket.userID,
        username: socket.username,
        latitd: socket.latitd,
        longitd: socket.longitd,
        connected: true,
      });  
      // notify existing users
      socket.broadcast.emit("user updated", {
          userID: socket.userID,
          latitd: socket.latitd,
          longitd: socket.longitd,
        });
    });

  // notify users upon disconnection
  socket.on("disconnect", async () => {
    const matchingSockets = await io.in(socket.userID).allSockets();
    const isDisconnected = matchingSockets.size === 0;
    if (isDisconnected) {
      // notify other users
      socket.broadcast.emit("user disconnected", socket.userID);
      // update the connection status of the session
      sessionStore.saveSession(socket.sessionID, {
        userID: socket.userID,
        username: socket.username,
        latitd: null,
        longitd: null,
        connected: false,
      });
    }
  });
});

setupWorker(io);
