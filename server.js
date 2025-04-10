import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const allowed = ["https://skyfallplanning.pages.dev"];

      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS!"));
      }
    },
    methods: ["GET"],
  },
});

const PORT = process.env.PORT || 4000;
let rooms = {};
let admins = {};
let decks = {};
let visibility = {};

// TODO: move to utils
function sanitizeName(name) {
  return name
    .replace(/<\/?[^>]+(>|$)/g, "")
    .substring(0, 20)
    .replace(/[^\w\s-]/gi, "");
}

function getUpdatedData(roomId) {
  return {
    room: getRoomWithoutVotes(rooms[roomId]),
    admin: admins[roomId],
    deck: decks[roomId],
    isVisible: visibility[roomId],
  };
}

function getRoomWithoutVotes(room) {
  const cleanRoom = {};

  for (const userId in room) {
    cleanRoom[userId] = {
      ...room[userId],
      vote:
        room[userId].vote !== undefined && room[userId].vote !== null
          ? "*"
          : room[userId].vote,
    };
  }

  return cleanRoom;
}

io.on("connection", (socket) => {
  socket.on("joinRoom", ({ roomId, name, deck }) => {
    // TODO: utils
    if (!/^[a-zA-Z0-9]{4,10}$/.test(roomId)) {
      return socket.emit("error", "Invalid room id");
    }

    // user create room - admin
    if (!rooms[roomId]) {
      rooms[roomId] = {
        [socket.id]: {
          name: sanitizeName(name),
        },
      };

      admins[roomId] = socket.id;
    } else {
      if (rooms[roomId][socket.id]) {
        io.to(roomId).emit("updateRoom", getUpdatedData(roomId));
        return;
      }

      // user join existing room
      rooms[roomId] = {
        ...rooms[roomId],
        [socket.id]: {
          name: sanitizeName(name),
        },
      };

      if (!admins[roomId]) {
        admins[roomId] = socket.id;
      }
    }

    if (!decks[roomId]) {
      decks[roomId] = deck;
    }

    socket.join(roomId);
    io.to(roomId).emit("updateRoom", getUpdatedData(roomId));
  });

  socket.on("checkRoom", (roomId, checkName, callback) => {
    const room = io.sockets.adapter.rooms.get(roomId);
    const exists = !!room && room.size > 0;

    if (checkName) {
      callback(exists && room?.[roomId]?.[socket.id]);
      return;
    }

    callback(exists);
  });

  socket.on("vote", ({ roomId, vote }) => {
    if (rooms?.[roomId]?.[socket.id]) {
      rooms[roomId][socket.id] = {
        ...rooms[roomId][socket.id],
        vote,
      };

      io.to(roomId).emit("updateRoom", getUpdatedData(roomId));
    }
  });

  socket.on("toggleVisibility", (roomId) => {
    visibility[roomId] = !visibility[roomId];

    io.to(roomId).emit("toggleVisibility", {
      room: rooms[roomId],
      isVisible: visibility[roomId],
    });
  });

  socket.on("deleteVotes", (roomId) => {
    Object.keys(rooms[roomId]).forEach((userId) => {
      if (rooms[roomId][userId]) {
        const { vote, ...noVote } = rooms[roomId][userId];

        rooms[roomId][userId] = {
          ...noVote,
        };
      }
    });

    visibility[roomId] = false;

    io.to(roomId).emit("deleteVotes", rooms[roomId]);
  });

  socket.on("disconnect", () => {
    Object.keys(rooms).forEach((roomId) => {
      if (rooms?.[roomId]?.[socket.id]) {
        rooms[roomId] = Object.fromEntries(
          Object.entries(rooms[roomId]).filter(
            ([userId]) => userId !== socket.id
          )
        );

        // TODO: should room be terminated? Redirect users to "/"?
        if (admins[roomId] === socket.id) {
          admins[roomId] = undefined;
        }

        io.to(roomId).emit("updateRoom", getUpdatedData(roomId));
      }
    });

    // TODO: do not clean if there's still one user - deck lost on refresh
    Object.keys(rooms).forEach((roomId) => {
      if (!Object.entries(rooms[roomId]).length) {
        rooms = Object.fromEntries(
          Object.entries(rooms).filter(([_roomId]) => _roomId !== roomId)
        );

        admins = Object.fromEntries(
          Object.entries(admins).filter(([_roomId]) => _roomId !== roomId)
        );

        decks = Object.fromEntries(
          Object.entries(decks).filter(([_roomId]) => _roomId !== roomId)
        );

        visibility = Object.fromEntries(
          Object.entries(visibility).filter(([_roomId]) => _roomId !== roomId)
        );
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
