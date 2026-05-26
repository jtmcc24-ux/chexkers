try {
  require("dotenv").config();
} catch (error) {
  // dotenv is optional in production hosts that provide environment variables directly.
}

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const CLIENT_ORIGINS = (
  process.env.CLIENT_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000,https://chexkers.com,https://www.chexkers.com"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CLIENT_ORIGINS.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    name: "CHEXKERS server",
    time: new Date().toISOString(),
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});


const USERS_FILE = path.join(__dirname, "users.json");
const MATCHES_FILE = path.join(__dirname, "matches.json");

function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

function loadUsers() {
  ensureUsersFile();

  try {
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch (error) {
    console.error("Failed to load users.json:", error);
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify({ users }, null, 2)
  );
}

function ensureMatchesFile() {
  if (!fs.existsSync(MATCHES_FILE)) {
    fs.writeFileSync(MATCHES_FILE, JSON.stringify({ matches: [] }, null, 2));
  }
}

function loadMatches() {
  ensureMatchesFile();

  try {
    const raw = fs.readFileSync(MATCHES_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    return Array.isArray(parsed.matches) ? parsed.matches : [];
  } catch (error) {
    console.error("Failed to load matches.json:", error);
    return [];
  }
}

function saveMatches(matches) {
  fs.writeFileSync(
    MATCHES_FILE,
    JSON.stringify({ matches }, null, 2)
  );
}

function saveCompletedMatch(table, winnerColor, reason) {
  if (!table || !table.gameState) return null;
  if (table.gameState.matchSaved) return table.gameState.savedMatch || null;

  const winnerName = winnerColor === "red" ? table.redPlayer : table.blackPlayer;
  const loserName = winnerColor === "red" ? table.blackPlayer : table.redPlayer;

  const match = {
    id: crypto.randomUUID(),
    tableId: table.id,
    room: table.room,
    gameType: table.gameType,
    reason,
    redPlayer: table.redPlayer,
    blackPlayer: table.blackPlayer,
    winnerColor,
    winnerName,
    loserName,
    redCaptured: table.gameState.redCaptured || 0,
    blackCaptured: table.gameState.blackCaptured || 0,
    moveCount: Array.isArray(table.gameState.moveHistory)
      ? table.gameState.moveHistory.length
      : 0,
    moveHistory: table.gameState.moveHistory || [],
    ratingResult: table.gameState.ratingResult || null,
    createdAt: new Date().toISOString(),
  };

  const matches = loadMatches();
  matches.push(match);

  while (matches.length > 500) {
    matches.shift();
  }

  saveMatches(matches);

  table.gameState.matchSaved = true;
  table.gameState.savedMatch = match;

  return match;
}

function getMatchesForScreenName(screenName) {
  const name = String(screenName || "").toLowerCase();

  return loadMatches()
    .filter(
      (match) =>
        String(match.redPlayer || "").toLowerCase() === name ||
        String(match.blackPlayer || "").toLowerCase() === name
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeScreenName(screenName) {
  return String(screenName || "").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidScreenName(screenName, email) {
  const normalizedEmail = normalizeEmail(email);

  // Owner exception: Jacob can use the 2-letter screen name "JT".
  if (
    normalizedEmail === "jtmcc24@gmail.com" &&
    screenName.toLowerCase() === "jt"
  ) {
    return true;
  }

  return /^[A-Za-z0-9_]{3,16}$/.test(screenName);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto
    .pbkdf2Sync(String(password), salt, 100000, 64, "sha512")
    .toString("hex");

  return {
    salt,
    hash,
  };
}

function verifyPassword(password, salt, storedHash) {
  const result = hashPassword(password, salt);
  return crypto.timingSafeEqual(
    Buffer.from(result.hash, "hex"),
    Buffer.from(storedHash, "hex")
  );
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    screenName: user.screenName,
    rating: user.rating,
    wins: user.wins || 0,
    losses: user.losses || 0,
    createdAt: user.createdAt,
  };
}


function calculateEloChange(winnerRating, loserRating, kFactor = 32) {
  const expectedWinner =
    1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));

  const winnerDelta = Math.round(kFactor * (1 - expectedWinner));
  const loserDelta = -winnerDelta;

  return {
    winnerDelta,
    loserDelta,
  };
}

function getUserByScreenName(screenName) {
  const users = loadUsers();

  return users.find(
    (user) =>
      user.screenName.toLowerCase() === String(screenName || "").toLowerCase()
  );
}

function applyRankedResult(table, winnerColor, reason) {
  if (!table || !table.gameState) return;
  if (table.gameState.ratingApplied) return;
  if (table.opponentType === "Computer") return;
  if (table.gameType !== "Ranked") return;

  const redUser = getUserByScreenName(table.redPlayer);
  const blackUser = getUserByScreenName(table.blackPlayer);

  if (!redUser || !blackUser) return;

  const winnerUser = winnerColor === "red" ? redUser : blackUser;
  const loserUser = winnerColor === "red" ? blackUser : redUser;

  const beforeWinnerRating = winnerUser.rating || 1500;
  const beforeLoserRating = loserUser.rating || 1500;

  const { winnerDelta, loserDelta } = calculateEloChange(
    beforeWinnerRating,
    beforeLoserRating
  );

  winnerUser.rating = Math.max(100, beforeWinnerRating + winnerDelta);
  loserUser.rating = Math.max(100, beforeLoserRating + loserDelta);

  winnerUser.wins = (winnerUser.wins || 0) + 1;
  loserUser.losses = (loserUser.losses || 0) + 1;

  const users = loadUsers().map((user) => {
    if (user.id === winnerUser.id) return winnerUser;
    if (user.id === loserUser.id) return loserUser;
    return user;
  });

  saveUsers(users);

  table.gameState.ratingApplied = true;
  table.gameState.ratingResult = {
    ranked: true,
    reason,
    winnerColor,
    winnerScreenName: winnerUser.screenName,
    loserScreenName: loserUser.screenName,
    winnerDelta,
    loserDelta,
    winnerRating: winnerUser.rating,
    loserRating: loserUser.rating,
  };

  pushSystemFeed({
    text: `${winnerUser.screenName} defeated ${loserUser.screenName} in Ranked and reached ${winnerUser.rating} rating.`,
    type: "ranked",
  });

  io.emit("leaderboardUpdated", getLeaderboard());
}

function getLeaderboard() {
  return loadUsers()
    .map(publicUser)
    .sort((a, b) => b.rating - a.rating)
    .slice(0, 25);
}



function getRatingForScreenName(screenName) {
  const user = getUserByScreenName(screenName);

  return user?.rating || 1500;
}

function getSocketScreenName(socket) {
  return socket.data?.user?.screenName || "GuestPlayer";
}

function findReconnectableTableForUser(user) {
  if (!user || !user.screenName) return null;

  return activeTables.find((table) => {
    if (!table || table.status === "Finished") return false;

    return (
      table.redPlayer === user.screenName ||
      table.blackPlayer === user.screenName
    );
  });
}

function reconnectSocketToTable(socket, table) {
  if (!socket || !table || !socket.data?.user) return null;

  let role = "spectator";

  if (table.redPlayer === socket.data.user.screenName) {
    table.hostSocket = socket.id;
    role = "red";
  }

  if (table.blackPlayer === socket.data.user.screenName) {
    table.blackSocket = socket.id;
    role = "black";
  }

  socket.join(table.id);

  socket.emit("reconnectedToTable", {
    table,
    role,
  });

  socket.emit("tableState", table);
  socket.emit("gameStateUpdated", table.gameState);
  broadcastTableMessages(table);

  broadcastTables();

  return role;
}


const activeTables = [];
const connectedPlayers = new Map();
const tournaments = [];
const matchmakingQueue = [];

const lobbyMessages = [
  {
    id: "seed-chat-1",
    sender: "System",
    text: "Welcome to CHEXKERS.",
    createdAt: Date.now(),
    type: "system",
  },
];

const systemFeed = [
  {
    id: "seed-feed-1",
    text: "CHEXKERS online services started.",
    createdAt: Date.now(),
    type: "system",
  },
];

function createTableMessages() {
  return [
    {
      id: `table-system-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sender: "System",
      text: "Table opened.",
      createdAt: Date.now(),
      type: "system",
    },
  ];
}

function addTableMessage(table, sender, text, type = "chat") {
  if (!table) return;

  if (!Array.isArray(table.tableMessages)) {
    table.tableMessages = createTableMessages();
  }

  const cleanText = String(text || "").trim().slice(0, 220);
  if (!cleanText) return;

  table.tableMessages.push({
    id: `table-msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sender: sender || "System",
    text: cleanText,
    createdAt: Date.now(),
    type,
  });

  if (table.tableMessages.length > 80) {
    table.tableMessages = table.tableMessages.slice(-80);
  }

  io.to(table.id).emit("tableMessagesUpdated", {
    tableId: table.id,
    messages: table.tableMessages,
  });
}

function broadcastTableMessages(table) {
  if (!table) return;

  if (!Array.isArray(table.tableMessages)) {
    table.tableMessages = createTableMessages();
  }

  io.to(table.id).emit("tableMessagesUpdated", {
    tableId: table.id,
    messages: table.tableMessages,
  });
}

function createStartingBoard() {
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => {
      const playable = (row + col) % 2 === 1;
      if (!playable) return null;
      if (row < 3) return { color: "black", king: false };
      if (row > 4) return { color: "red", king: false };
      return null;
    })
  );
}

function cloneBoard(board) {
  return board.map((row) =>
    row.map((piece) => (piece ? { ...piece } : null))
  );
}

function inBounds(row, col) {
  return row >= 0 && row < 8 && col >= 0 && col < 8;
}

function getDirections(piece) {
  if (!piece) return [];

  if (piece.king) {
    return [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
  }

  return piece.color === "red"
    ? [
        [-1, -1],
        [-1, 1],
      ]
    : [
        [1, -1],
        [1, 1],
      ];
}

function getMoves(board, row, col) {
  const piece = board[row]?.[col];
  if (!piece) return [];

  const moves = [];

  for (const [dr, dc] of getDirections(piece)) {
    const moveRow = row + dr;
    const moveCol = col + dc;

    if (
      inBounds(moveRow, moveCol) &&
      board[moveRow][moveCol] === null
    ) {
      moves.push({ row: moveRow, col: moveCol });
    }

    const jumpRow = row + dr * 2;
    const jumpCol = col + dc * 2;

    if (!inBounds(jumpRow, jumpCol)) continue;

    const middle = board[moveRow]?.[moveCol];

    if (
      middle &&
      middle.color !== piece.color &&
      board[jumpRow][jumpCol] === null
    ) {
      moves.push({
        row: jumpRow,
        col: jumpCol,
        capture: { row: moveRow, col: moveCol },
      });
    }
  }

  return moves;
}

function getCaptureMoves(board, row, col) {
  return getMoves(board, row, col).filter((move) => move.capture);
}

function getAllCaptures(board, color) {
  const captures = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece.color !== color) continue;

      if (getCaptureMoves(board, row, col).length > 0) {
        captures.push({ row, col });
      }
    }
  }

  return captures;
}

function getLegalMoves(board, turn, forcedPiece, row, col) {
  const piece = board[row]?.[col];

  if (!piece || piece.color !== turn) return [];

  if (
    forcedPiece &&
    (forcedPiece.row !== row || forcedPiece.col !== col)
  ) {
    return [];
  }

  if (forcedPiece) {
    return getCaptureMoves(board, row, col);
  }

  const forcedCaptures = getAllCaptures(board, turn);

  if (forcedCaptures.length > 0) {
    return getCaptureMoves(board, row, col);
  }

  return getMoves(board, row, col);
}

function hasAnyMoves(board, color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (!piece || piece.color !== color) continue;

      if (getMoves(board, row, col).length > 0) return true;
    }
  }

  return false;
}

function checkWinner(board) {
  const redPieces = board.flat().filter((piece) => piece?.color === "red").length;
  const blackPieces = board.flat().filter((piece) => piece?.color === "black").length;

  if (redPieces === 0) return "black";
  if (blackPieces === 0) return "red";
  if (!hasAnyMoves(board, "red")) return "black";
  if (!hasAnyMoves(board, "black")) return "red";

  return null;
}

function parseTotalSeconds(timeControl) {
  if (timeControl === "No Timer") return null;
  if (timeControl === "5 Minutes") return 5 * 60;
  if (timeControl === "10 Minutes") return 10 * 60;
  if (timeControl === "15 Minutes") return 15 * 60;
  if (timeControl === "30 Minutes") return 30 * 60;
  return 5 * 60;
}

function parseMoveSeconds(moveTimer) {
  if (moveTimer === "No Move Timer") return null;
  if (moveTimer === "30 Seconds") return 30;
  if (moveTimer === "60 Seconds") return 60;
  if (moveTimer === "90 Seconds") return 90;
  return 30;
}


function squareName(row, col) {
  const files = ["A", "B", "C", "D", "E", "F", "G", "H"];
  return `${files[col]}${8 - row}`;
}

function makeMoveNotation(piece, from, to, legalMove, promoted) {
  const colorName = piece?.color === "red" ? "Red" : "Black";
  const pieceName = piece?.king ? "King" : "Piece";
  const connector = legalMove.capture ? "x" : "-";
  const crown = promoted ? " = KING" : "";

  return `${colorName} ${pieceName} ${squareName(from.row, from.col)}${connector}${squareName(to.row, to.col)}${crown}`;
}


function getBotDepthForRating(rating, botMode = "Beginner Bot") {
  if (botMode === "Beginner Bot") return 1;
  if (botMode === "Intermediate Bot") return 2;
  if (botMode === "Advanced Bot") return 4;
  if (botMode === "Expert Bot") return 5;
  if (botMode === "Master Bot") return 8;

  const value = Number(rating || 1500);

  return 2;
}

function countPieces(board, color) {
  let count = 0;

  for (const row of board) {
    for (const piece of row) {
      if (piece?.color === color) {
        count += 1;
      }
    }
  }

  return count;
}


function getBotRatingForMode(playerRating, botMode = "Beginner Bot") {
  const rating = Number(playerRating || 1500);

  if (botMode === "Beginner Bot") return 900;
  if (botMode === "Intermediate Bot") return 1250;
  if (botMode === "Advanced Bot") return 1650;
  if (botMode === "Expert Bot") return 2000;
  if (botMode === "Master Bot") return 2400;

  return rating;
}

function evaluateBoard(board, botColor) {
  const opponentColor = botColor === "black" ? "red" : "black";

  const botPieces = countPieces(board, botColor);
  const opponentPieces = countPieces(board, opponentColor);

  if (opponentPieces === 0) return 100000;
  if (botPieces === 0) return -100000;

  let score = 0;

  const botMoves = getAllLegalMoveOptions(board, botColor, null).length;
  const opponentMoves = getAllLegalMoveOptions(board, opponentColor, null).length;
  const botCaptures = getAllCaptures(board, botColor).length;
  const opponentCaptures = getAllCaptures(board, opponentColor).length;

  score += (botMoves - opponentMoves) * 8;
  score += (botCaptures - opponentCaptures) * 55;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];

      if (!piece) continue;

      const isBot = piece.color === botColor;
      let value = piece.king ? 190 : 100;

      // Advancement matters for men.
      if (!piece.king) {
        value += piece.color === "black" ? row * 8 : (7 - row) * 8;
      }

      // Center control is valuable.
      if (row >= 2 && row <= 5 && col >= 2 && col <= 5) {
        value += 16;
      }

      // Back row guards are useful early/midgame.
      if (!piece.king) {
        if (piece.color === "black" && row === 0) value += 8;
        if (piece.color === "red" && row === 7) value += 8;
      }

      // Edge pieces are a little safer but less mobile.
      if (col === 0 || col === 7) {
        value += 4;
      }

      // Pieces close to kinging.
      if (!piece.king) {
        if (piece.color === "black" && row >= 5) value += 25;
        if (piece.color === "red" && row <= 2) value += 25;
      }

      score += isBot ? value : -value;
    }
  }

  if (opponentMoves === 0) score += 5000;
  if (botMoves === 0) score -= 5000;

  return score;
}

function simulateMoveForBot(board, from, move) {
  const newBoard = cloneBoard(board);
  const movingPiece = newBoard[from.row][from.col];

  newBoard[move.row][move.col] = movingPiece;
  newBoard[from.row][from.col] = null;

  if (move.capture) {
    newBoard[move.capture.row][move.capture.col] = null;
  }

  if (movingPiece?.color === "red" && move.row === 0) {
    movingPiece.king = true;
  }

  if (movingPiece?.color === "black" && move.row === 7) {
    movingPiece.king = true;
  }

  return newBoard;
}

function getAllLegalMoveOptions(board, turn, forcedPiece) {
  const options = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];

      if (!piece || piece.color !== turn) continue;

      const legalMoves = getLegalMoves(board, turn, forcedPiece, row, col);

      for (const move of legalMoves) {
        options.push({
          from: { row, col },
          move,
        });
      }
    }
  }

  return options;
}

function getTurnAfterSimulatedMove(board, currentColor, from, move) {
  const simulatedBoard = simulateMoveForBot(board, from, move);

  if (move.capture) {
    const followUpCaptures = getCaptureMoves(
      simulatedBoard,
      move.row,
      move.col
    );

    if (followUpCaptures.length > 0) {
      return {
        board: simulatedBoard,
        nextTurn: currentColor,
        forcedPiece: {
          row: move.row,
          col: move.col,
        },
      };
    }
  }

  return {
    board: simulatedBoard,
    nextTurn: currentColor === "red" ? "black" : "red",
    forcedPiece: null,
  };
}

function minimaxBot(board, turn, forcedPiece, depth, alpha, beta, botColor) {
  const opponentColor = botColor === "black" ? "red" : "black";

  const botPieces = countPieces(board, botColor);
  const opponentPieces = countPieces(board, opponentColor);

  if (opponentPieces === 0) return 100000 + depth;
  if (botPieces === 0) return -100000 - depth;

  const options = getAllLegalMoveOptions(board, turn, forcedPiece);

  if (options.length === 0) {
    return turn === botColor ? -90000 - depth : 90000 + depth;
  }

  if (depth <= 0) {
    return evaluateBoard(board, botColor);
  }

  const maximizing = turn === botColor;

  if (maximizing) {
    let bestScore = -Infinity;

    for (const option of options) {
      const result = getTurnAfterSimulatedMove(
        board,
        turn,
        option.from,
        option.move
      );

      const score = minimaxBot(
        result.board,
        result.nextTurn,
        result.forcedPiece,
        result.nextTurn === turn ? depth : depth - 1,
        alpha,
        beta,
        botColor
      );

      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, bestScore);

      if (beta <= alpha) break;
    }

    return bestScore;
  }

  let bestScore = Infinity;

  for (const option of options) {
    const result = getTurnAfterSimulatedMove(
      board,
      turn,
      option.from,
      option.move
    );

    const score = minimaxBot(
      result.board,
      result.nextTurn,
      result.forcedPiece,
      result.nextTurn === turn ? depth : depth - 1,
      alpha,
      beta,
      botColor
    );

    bestScore = Math.min(bestScore, score);
    beta = Math.min(beta, bestScore);

    if (beta <= alpha) break;
  }

  return bestScore;
}

function pickBotMove(table) {
  const gameState = table.gameState;
  const botColor = "black";
  const depth = table.botDepth || 2;
  const isMasterBot =
    table.blackPlayer === "Master_Bot" ||
    table.computerSkill === "Master Bot" ||
    depth >= 7;

  const options = getAllLegalMoveOptions(
    gameState.board,
    gameState.turn,
    gameState.forcedPiece
  );

  if (options.length === 0) return null;

  let bestOption = options[0];
  let bestScore = -Infinity;

  // Calibrated non-master bots:
  // Beginner/Intermediate remain imperfect, Advanced+ uses shallow minimax.
  if (!isMasterBot) {
    const searchDepth = Math.max(1, Math.min(depth, 5));

    for (const option of options) {
      const result = getTurnAfterSimulatedMove(
        gameState.board,
        gameState.turn,
        option.from,
        option.move
      );

      let score =
        depth >= 3
          ? minimaxBot(
              result.board,
              result.nextTurn,
              result.forcedPiece,
              result.nextTurn === gameState.turn
                ? searchDepth
                : searchDepth - 1,
              -Infinity,
              Infinity,
              botColor
            )
          : evaluateBoard(result.board, botColor);

      if (option.move.capture) score += 50 + depth * 12;

      const movingPiece = gameState.board[option.from.row][option.from.col];

      if (
        movingPiece &&
        !movingPiece.king &&
        ((movingPiece.color === "black" && option.move.row === 7) ||
          (movingPiece.color === "red" && option.move.row === 0))
      ) {
        score += 30 + depth * 10;
      }

      if (depth >= 2) {
        const opponent = botColor === "black" ? "red" : "black";
        const opponentCaptures = getAllCaptures(result.board, opponent);
        score -= opponentCaptures.length * (25 + depth * 10);
      }

      // Difficulty calibration:
      // depth 1 = very imperfect, depth 2 = some mistakes,
      // depth 4+ = much cleaner, depth 5/6 = strong.
      const randomness =
        depth <= 1
          ? 140
          : depth === 2
          ? 85
          : depth === 3
          ? 45
          : depth === 4
          ? 18
          : 6;

      score += Math.random() * randomness;

      if (score > bestScore) {
        bestScore = score;
        bestOption = option;
      }
    }

    return bestOption;
  }

  // Master Bot uses minimax/alpha-beta and avoids randomness.
  const searchDepth = 7;

  for (const option of options) {
    const result = getTurnAfterSimulatedMove(
      gameState.board,
      gameState.turn,
      option.from,
      option.move
    );

    let score = minimaxBot(
      result.board,
      result.nextTurn,
      result.forcedPiece,
      result.nextTurn === gameState.turn ? searchDepth : searchDepth - 1,
      -Infinity,
      Infinity,
      botColor
    );

    // Strong priorities for immediate tactical correctness.
    if (option.move.capture) score += 180;

    const movingPiece = gameState.board[option.from.row][option.from.col];

    if (
      movingPiece &&
      !movingPiece.king &&
      movingPiece.color === "black" &&
      option.move.row === 7
    ) {
      score += 220;
    }

    // Avoid landing where opponent immediately has many captures.
    const opponentCaptures = getAllCaptures(result.board, "red").length;
    score -= opponentCaptures * 90;

    if (score > bestScore) {
      bestScore = score;
      bestOption = option;
    }
  }

  return bestOption;
}

function makeServerMove(table, from, to) {
  if (!table || !table.gameState || table.gameState.winner) return false;

  const gameState = table.gameState;

  const legalMoves = getLegalMoves(
    gameState.board,
    gameState.turn,
    gameState.forcedPiece,
    from.row,
    from.col
  );

  const legalMove = legalMoves.find(
    (move) => move.row === to.row && move.col === to.col
  );

  if (!legalMove) return false;

  const newBoard = cloneBoard(gameState.board);
  const movingPiece = newBoard[from.row][from.col];
  const wasKing = Boolean(movingPiece?.king);

  newBoard[to.row][to.col] = movingPiece;
  newBoard[from.row][from.col] = null;

  let performedCapture = false;

  if (legalMove.capture) {
    performedCapture = true;

    const capturedPiece =
      newBoard[legalMove.capture.row][legalMove.capture.col];

    if (capturedPiece?.color === "red") {
      gameState.redCaptured += 1;
    }

    if (capturedPiece?.color === "black") {
      gameState.blackCaptured += 1;
    }

    newBoard[legalMove.capture.row][legalMove.capture.col] = null;
  }

  if (movingPiece?.color === "red" && to.row === 0) {
    movingPiece.king = true;
  }

  if (movingPiece?.color === "black" && to.row === 7) {
    movingPiece.king = true;
  }

  const promoted = Boolean(movingPiece?.king && !wasKing);

  gameState.lastMove = {
    from,
    to,
    capture: legalMove.capture || null,
    promoted,
  };

  gameState.moveHistory.push({
    number: gameState.moveHistory.length + 1,
    color: movingPiece?.color || gameState.turn,
    from,
    to,
    capture: legalMove.capture || null,
    promoted,
    notation: makeMoveNotation(movingPiece, from, to, legalMove, promoted),
  });

  gameState.board = newBoard;

  if (performedCapture) {
    const additionalCaptures = getCaptureMoves(newBoard, to.row, to.col);

    if (additionalCaptures.length > 0) {
      gameState.forcedPiece = {
        row: to.row,
        col: to.col,
      };

      gameState.multiJumpActive = true;

      broadcastGame(table);
      return true;
    }
  }

  gameState.forcedPiece = null;
  gameState.multiJumpActive = false;

  const winner = checkWinner(newBoard);

  if (winner) {
    gameState.winner = winner;
    table.status = "Finished";

    applyRankedResult(table, winner, "checkers");
    saveCompletedMatch(table, winner, "checkers");

    io.to(table.id).emit("tableState", table);
    broadcastTables();
    broadcastGame(table);

    return true;
  }

  gameState.turn = gameState.turn === "red" ? "black" : "red";
  gameState.moveTimeLeft = gameState.moveTimerStart;

  broadcastGame(table);
  return true;
}

function maybeScheduleBotMove(table) {
  if (!table || !table.gameState) return;
  if (table.opponentType !== "Computer") return;
  if (table.status !== "Playing") return;
  if (table.gameState.winner) return;
  if (table.gameState.turn !== "black") return;

  const delay =
    table.blackPlayer === "Master_Bot" || table.computerSkill === "Master Bot"
      ? 900
      : 650;

  setTimeout(() => {
    const liveTable = activeTables.find((item) => item.id === table.id);

    if (!liveTable || !liveTable.gameState) return;
    if (liveTable.opponentType !== "Computer") return;
    if (liveTable.status !== "Playing") return;
    if (liveTable.gameState.winner) return;
    if (liveTable.gameState.turn !== "black") return;

    const botMove = pickBotMove(liveTable);

    if (!botMove) {
      liveTable.gameState.winner = "red";
      liveTable.status = "Finished";

      saveCompletedMatch(liveTable, "red", "no-moves");

      io.to(liveTable.id).emit("tableState", liveTable);
      broadcastTables();
      broadcastGame(liveTable);
      return;
    }

    makeServerMove(liveTable, botMove.from, {
      row: botMove.move.row,
      col: botMove.move.col,
    });

    // Continue automatic multi-jump if the bot still has a forced capture.
    maybeScheduleBotMove(liveTable);
  }, delay);
}


function createGameState(timeControl = "5 Minutes", moveTimer = "30 Seconds") {
  const totalSeconds = parseTotalSeconds(timeControl);
  const moveSeconds = parseMoveSeconds(moveTimer);

  return {
    board: createStartingBoard(),
    turn: "red",
    winner: null,
    forcedPiece: null,
    redCaptured: 0,
    blackCaptured: 0,
    multiJumpActive: false,

    redTimeLeft: totalSeconds,
    blackTimeLeft: totalSeconds,
    moveTimeLeft: moveSeconds,
    moveTimerStart: moveSeconds,
    timeoutWinner: null,

    lastMove: null,
    moveHistory: [],
    matchSaved: false,
    savedMatch: null,
  };
}


function removeFromMatchmaking(socketId) {
  const index = matchmakingQueue.findIndex((entry) => entry.socketId === socketId);

  if (index >= 0) {
    matchmakingQueue.splice(index, 1);
    return true;
  }

  return false;
}

function getQueueEntry(socketId) {
  return matchmakingQueue.find((entry) => entry.socketId === socketId);
}

function createMatchmakingTable(hostSocket, guestSocket, room, gameType) {
  const timeControl = "5 Minutes";
  const moveTimer = "30 Seconds";

  const table = {
    id: Date.now().toString(),
    hostSocket: hostSocket.id,
    blackSocket: guestSocket.id,

    room: room || "beginner",

    redPlayer: getSocketScreenName(hostSocket),
    blackPlayer: getSocketScreenName(guestSocket),

    gameType: gameType || "Casual",
    timeControl,
    moveTimer,

    spectators: 0,
    status: "Playing",

    allowSpectators: true,
    spectatorChat: true,
    ratedOnly: false,
    privateTable: false,

    opponentType: "Human",
    computerSkill: "Around My Rating",

    gameState: createGameState(timeControl, moveTimer),
    tableMessages: createTableMessages(),
  };

  activeTables.push(table);

  hostSocket.join(table.id);
  guestSocket.join(table.id);

  hostSocket.emit("matchFound", {
    table,
    role: "red",
  });

  guestSocket.emit("matchFound", {
    table,
    role: "black",
  });

  io.to(table.id).emit("tableState", table);
  broadcastGame(table);
  broadcastTables();

  pushSystemFeed({
    text: `Match found: ${table.redPlayer} vs ${table.blackPlayer} (${table.gameType}).`,
    type: table.gameType === "Ranked" ? "ranked" : "matchmaking",
  });

  return table;
}


function pushLobbyMessage(message) {
  lobbyMessages.push({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...message,
  });

  while (lobbyMessages.length > 75) {
    lobbyMessages.shift();
  }

  io.emit("lobbyMessagesUpdated", lobbyMessages);
}

function pushSystemFeed(item) {
  systemFeed.push({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    ...item,
  });

  while (systemFeed.length > 75) {
    systemFeed.shift();
  }

  io.emit("systemFeedUpdated", systemFeed);
}

function broadcastLobbyData(socket) {
  maybeSeedDefaultTournament();
  socket.emit("lobbyMessagesUpdated", lobbyMessages);
  socket.emit("systemFeedUpdated", systemFeed);
  socket.emit("tournamentsUpdated", tournaments);
  socket.emit("featuredMatchUpdated", getFeaturedMatch());
  socket.emit("livePlayersUpdated", getLivePlayersForLobby());
  if (typeof getLeaderboardPlayers === "function") {
    socket.emit("leaderboardUpdated", getLeaderboardPlayers());
  }
}


function broadcastTournaments() {
  io.emit("tournamentsUpdated", tournaments);
}

function getTournamentPlayer(socket) {
  const user = socket.data?.user;

  return {
    screenName: user?.screenName || "GuestPlayer",
    rating: user?.rating || 1500,
    joinedAt: Date.now(),
    eliminated: false,
    wins: 0,
  };
}

function shufflePlayers(players) {
  const shuffled = [...players];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }

  return shuffled;
}

function generateTournamentBracket(tournament) {
  const players = shufflePlayers(tournament.players);
  const matches = [];
  let matchNumber = 1;

  for (let index = 0; index < players.length; index += 2) {
    const player1 = players[index] || null;
    const player2 = players[index + 1] || null;

    matches.push({
      id: `${tournament.id}-r1-m${matchNumber}`,
      round: 1,
      matchNumber,
      player1,
      player2,
      winner: player2 ? null : player1,
      tableId: null,
      status: player2 ? "Waiting" : "Bye",
    });

    matchNumber += 1;
  }

  tournament.round = 1;
  tournament.status = "In Progress";
  tournament.bracket = [
    {
      round: 1,
      name: "Round 1",
      matches,
    },
  ];

  const byeWinners = matches
    .filter((match) => match.status === "Bye" && match.winner)
    .map((match) => match.winner?.screenName)
    .filter(Boolean);

  if (byeWinners.length > 0) {
    pushSystemFeed({
      text: `${byeWinners.join(", ")} advanced by BYE in ${tournament.name}.`,
      type: "table",
    });
  }
}

function maybeSeedDefaultTournament() {
  if (tournaments.length > 0) return;

  tournaments.push({
    id: "daily-ranked-cup",
    name: "Daily Ranked Cup",
    type: "Ranked",
    format: "Single Elimination",
    host: "System",
    maxPlayers: 8,
    status: "Waiting",
    createdAt: Date.now(),
    startsAt: Date.now() + 1000 * 60 * 30,
    round: 0,
    players: [],
    bracket: [],
    winner: null,
    allowSpectators: true,
    timeControl: "5 Minutes",
    moveTimer: "30 Seconds",
    chatEnabled: true,
  });
}


function serializeFeaturedMatch(table) {
  if (!table || !table.gameState) return null;

  const redRating = getRatingForScreenName(table.redPlayer);
  const blackRating = getRatingForScreenName(table.blackPlayer);

  return {
    id: table.id,
    room: table.room,
    redPlayer: table.redPlayer,
    blackPlayer: table.blackPlayer,
    redRating,
    blackRating,
    gameType: table.gameType,
    timeControl: table.timeControl,
    moveTimer: table.moveTimer,
    spectators: table.spectators || 0,
    status: table.status,
    opponentType: table.opponentType,
    currentTurn: table.gameState.turn,
    winner: table.gameState.winner,
    redTimeLeft: table.gameState.redTimeLeft,
    blackTimeLeft: table.gameState.blackTimeLeft,
    moveTimeLeft: table.gameState.moveTimeLeft,
    moveCount: Array.isArray(table.gameState.moveHistory)
      ? table.gameState.moveHistory.length
      : 0,
    board: table.gameState.board,
    lastMove: table.gameState.lastMove || null,
  };
}

function getFeaturedMatch() {
  const liveTables = activeTables.filter(
    (table) =>
      table.status === "Playing" &&
      table.gameState &&
      !table.gameState.winner &&
      table.blackPlayer &&
      table.blackPlayer !== "Open Seat"
  );

  if (liveTables.length === 0) return null;

  const scoredTables = liveTables.map((table) => {
    const redRating = getRatingForScreenName(table.redPlayer);
    const blackRating = getRatingForScreenName(table.blackPlayer);
    const combinedRating = redRating + blackRating;
    const rankedBonus = table.gameType === "Ranked" ? 10000 : 0;
    const spectatorBonus = (table.spectators || 0) * 50;
    const tournamentBonus = table.tournamentId ? 20000 : 0;

    return {
      table,
      score: combinedRating + rankedBonus + spectatorBonus + tournamentBonus,
    };
  });

  scoredTables.sort((a, b) => b.score - a.score);

  return serializeFeaturedMatch(scoredTables[0].table);
}

function broadcastFeaturedMatch() {
  io.emit("featuredMatchUpdated", getFeaturedMatch());
}


function getLivePlayersForLobby() {
  const liveByName = new Map();

  for (const player of connectedPlayers.values()) {
    if (!player?.screenName) continue;

    liveByName.set(player.screenName.toLowerCase(), {
      screenName: player.screenName,
      rating: player.rating || 1500,
      connectedAt: player.connectedAt || Date.now(),
    });
  }

  return Array.from(liveByName.values()).sort((a, b) => b.rating - a.rating);
}

function broadcastLivePlayers() {
  io.emit("livePlayersUpdated", getLivePlayersForLobby());

  if (typeof getLeaderboardPlayers === "function") {
    io.emit("leaderboardUpdated", getLeaderboardPlayers());
  }
}

function broadcastLobbyRealtime() {
  if (typeof broadcastTables === "function") broadcastTables();
  broadcastLivePlayers();
  if (typeof broadcastTournaments === "function") broadcastTournaments();
  if (typeof broadcastFeaturedMatch === "function") broadcastFeaturedMatch();
}

function broadcastTables() {
  io.emit("tablesUpdated", activeTables);
  broadcastFeaturedMatch();
}

function broadcastGame(table) {
  io.to(table.id).emit("gameStateUpdated", {
    tableId: table.id,
    gameState: table.gameState,
  });

  broadcastFeaturedMatch();
}

function getAllLegalMovesForColor(board, color, forcedPiece = null) {
  const moves = [];

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row]?.[col];
      if (!piece || piece.color !== color) continue;

      const legalMoves = getLegalMoves(board, color, forcedPiece, row, col);

      for (const move of legalMoves) {
        moves.push({
          from: { row, col },
          to: { row: move.row, col: move.col },
          capture: move.capture || null,
        });
      }
    }
  }

  return moves;
}

function pickForcedTimerMove(table) {
  if (!table || !table.gameState) return null;

  const gameState = table.gameState;
  const moves = getAllLegalMovesForColor(
    gameState.board,
    gameState.turn,
    gameState.forcedPiece
  );

  if (moves.length === 0) return null;

  const captures = moves.filter((move) => move.capture);
  const pool = captures.length > 0 ? captures : moves;

  return pool[Math.floor(Math.random() * pool.length)];
}

function forceMoveOnMoveTimer(table) {
  if (!table || !table.gameState) return false;
  if (table.status !== "Playing") return false;
  if (table.gameState.winner) return false;

  const timedOutColor = table.gameState.turn;
  const forcedMove = pickForcedTimerMove(table);

  if (!forcedMove) {
    const winner = timedOutColor === "red" ? "black" : "red";
    table.gameState.winner = winner;
    table.gameState.timeoutWinner = winner;
    table.status = "Finished";

    addTableMessage(
      table,
      "System",
      `${timedOutColor.toUpperCase()} had no legal move when the move clock expired. ${winner.toUpperCase()} wins.`,
      "system"
    );

    applyRankedResult(table, winner, "no-legal-moves");
    saveCompletedMatch(table, winner, "no-legal-moves");

    io.to(table.id).emit("tableState", table);
    broadcastTables();
    broadcastGame(table);
    return true;
  }

  addTableMessage(
    table,
    "System",
    `${timedOutColor.toUpperCase()} move clock expired. CHEXKERS forced a legal move.`,
    "system"
  );

  const moved = makeServerMove(table, forcedMove.from, forcedMove.to);

  if (moved) {
    io.to(table.id).emit("tableState", table);
    broadcastTables();

    if (table.opponentType === "Computer") {
      maybeScheduleBotMove(table);
    }
  }

  return moved;
}

function finishByTimeout(table, winner) {
  table.gameState.winner = winner;
  table.gameState.timeoutWinner = winner;
  table.status = "Finished";

  io.to(table.id).emit("tableState", table);
  broadcastTables();
  broadcastGame(table);
}

setInterval(() => {
  let changedTables = false;

  for (const table of activeTables) {
    if (!table.gameState) continue;
    if (table.status !== "Playing") continue;
    if (table.gameState.winner) continue;

    const currentTurn = table.gameState.turn;

    if (currentTurn === "red" && table.gameState.redTimeLeft !== null) {
      table.gameState.redTimeLeft = Math.max(0, table.gameState.redTimeLeft - 1);

      if (table.gameState.redTimeLeft <= 0) {
        finishByTimeout(table, "black");
        changedTables = true;
        continue;
      }
    }

    if (currentTurn === "black" && table.gameState.blackTimeLeft !== null) {
      table.gameState.blackTimeLeft = Math.max(0, table.gameState.blackTimeLeft - 1);

      if (table.gameState.blackTimeLeft <= 0) {
        finishByTimeout(table, "red");
        changedTables = true;
        continue;
      }
    }

    if (table.gameState.moveTimeLeft !== null) {
      table.gameState.moveTimeLeft = Math.max(0, table.gameState.moveTimeLeft - 1);

      if (table.gameState.moveTimeLeft <= 0) {
        forceMoveOnMoveTimer(table);
        changedTables = true;
        continue;
      }
    }

    broadcastGame(table);
  }

  if (changedTables) {
    broadcastTables();
  }
}, 1000);


app.post("/api/register", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const screenName = normalizeScreenName(req.body.screenName);
  const password = String(req.body.password || "");

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid email." });
  }

  if (!isValidScreenName(screenName, email)) {
    return res.status(400).json({
      error:
        "Screen name must be 3-16 characters and use letters, numbers, or underscores only.",
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: "Password must be at least 6 characters.",
    });
  }

  const users = loadUsers();

  if (users.some((user) => user.email === email)) {
    return res.status(409).json({ error: "Email already registered." });
  }

  if (
    users.some(
      (user) =>
        user.screenName.toLowerCase() === screenName.toLowerCase()
    )
  ) {
    return res.status(409).json({ error: "Screen name already taken." });
  }

  const passwordData = hashPassword(password);

  const user = {
    id: crypto.randomUUID(),
    email,
    screenName,
    rating: 1500,
    wins: 0,
    losses: 0,
    passwordSalt: passwordData.salt,
    passwordHash: passwordData.hash,
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  saveUsers(users);

  pushSystemFeed({
    text: `${user.screenName} joined CHEXKERS.`,
    type: "account",
  });

  return res.json({ user: publicUser(user) });
});

app.post("/api/login", (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");

  const users = loadUsers();
  const user = users.find((item) => item.email === email);

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const passwordOk = verifyPassword(
    password,
    user.passwordSalt,
    user.passwordHash
  );

  if (!passwordOk) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  return res.json({ user: publicUser(user) });
});



app.get("/api/leaderboard", (req, res) => {
  return res.json({
    players: getLeaderboard(),
  });
});



app.get("/api/profile/:screenName", (req, res) => {
  const screenName = String(req.params.screenName || "").trim();
  const users = loadUsers();

  const user = users.find(
    (item) => item.screenName.toLowerCase() === screenName.toLowerCase()
  );

  if (!user) {
    return res.status(404).json({ error: "Player not found." });
  }

  const publicProfile = publicUser(user);

  return res.json({
    profile: {
      ...publicProfile,
      matchesPlayed: (publicProfile.wins || 0) + (publicProfile.losses || 0),
      winRate:
        (publicProfile.wins || 0) + (publicProfile.losses || 0) > 0
          ? Math.round(
              ((publicProfile.wins || 0) /
                ((publicProfile.wins || 0) + (publicProfile.losses || 0))) *
                100
            )
          : 0,
      recentMatches: getMatchesForScreenName(user.screenName),
    },
  });
});


app.get("/api/matches/:screenName", (req, res) => {
  const screenName = String(req.params.screenName || "").trim();

  return res.json({
    matches: getMatchesForScreenName(screenName),
  });
});

io.on("connection", (socket) => {
  function rememberSocketUser() {
    const user = socket.data?.user;

    if (!user?.screenName) return;

    connectedPlayers.set(socket.id, {
      screenName: user.screenName,
      rating: user.rating || 1500,
      connectedAt: Date.now(),
    });

    broadcastLivePlayers();
  }

  console.log("User connected:", socket.id);
  socket.emit("livePlayersUpdated", getLivePlayersForLobby());
  if (typeof getLeaderboardPlayers === "function") {
    socket.emit("leaderboardUpdated", getLeaderboardPlayers());
  }

  socket.on("setCurrentUser", (userData) => {
    if (!userData || !userData.id || !userData.screenName) {
      socket.data.user = null;
    rememberSocketUser();
      return;
    }

    socket.data.user = {
      id: userData.id,
      screenName: userData.screenName,
      rating: userData.rating || 1500,
    };

    console.log("Socket user set:", socket.id, socket.data.user.screenName);

    const reconnectableTable = findReconnectableTableForUser(socket.data.user);

    if (reconnectableTable) {
      const role = reconnectSocketToTable(socket, reconnectableTable);

      socket.emit("reconnectStatus", {
        success: true,
        message: `Reconnected as ${role}.`,
      });
    }
  });

  socket.on("requestReconnect", () => {
    const reconnectableTable = findReconnectableTableForUser(socket.data?.user);

    if (!reconnectableTable) {
      socket.emit("reconnectStatus", {
        success: false,
        message: "No active table to reconnect.",
      });
      return;
    }

    const role = reconnectSocketToTable(socket, reconnectableTable);

    socket.emit("reconnectStatus", {
      success: true,
      message: `Reconnected as ${role}.`,
    });
  });

  socket.on("joinLobby", () => {
    socket.emit("tablesUpdated", activeTables);
    broadcastLobbyData(socket);
  });


  socket.on("sendLobbyMessage", (text) => {
    const cleanText = String(text || "").trim().slice(0, 160);

    if (!cleanText) return;

    pushLobbyMessage({
      sender: getSocketScreenName(socket),
      text: cleanText,
      type: "chat",
    });
  });


  socket.on("joinTournament", (tournamentId) => {
    maybeSeedDefaultTournament();

    const tournament = tournaments.find((item) => item.id === tournamentId);

    if (!tournament) return;
    if (tournament.status !== "Waiting") return;

    const player = getTournamentPlayer(socket);

    if (
      tournament.players.some(
        (entry) =>
          entry.screenName.toLowerCase() === player.screenName.toLowerCase()
      )
    ) {
      return;
    }

    if (tournament.players.length >= tournament.maxPlayers) return;

    tournament.players.push(player);

    pushSystemFeed({
      text: `${player.screenName} joined ${tournament.name}.`,
      type: "table",
    });

    broadcastTournaments();
  });

  socket.on("leaveTournament", (tournamentId) => {
    const tournament = tournaments.find((item) => item.id === tournamentId);

    if (!tournament || tournament.status !== "Waiting") return;

    const player = getTournamentPlayer(socket);

    tournament.players = tournament.players.filter(
      (entry) =>
        entry.screenName.toLowerCase() !== player.screenName.toLowerCase()
    );

    pushSystemFeed({
      text: `${player.screenName} left ${tournament.name}.`,
      type: "table",
    });

    broadcastTournaments();
  });

  socket.on("createTournament", (data = {}) => {
    const host = getSocketScreenName(socket);

    const tournament = {
      id: crypto.randomUUID(),
      name: String(data.name || "Community Cup").slice(0, 36),
      type: data.type === "Ranked" ? "Ranked" : "Casual",
      format: "Single Elimination",
      host,
      maxPlayers: Number(data.maxPlayers || 8),
      status: "Waiting",
      createdAt: Date.now(),
      startsAt: Date.now() + 1000 * 60 * 30,
      round: 0,
      players: [getTournamentPlayer(socket)],
      bracket: [],
      winner: null,
      allowSpectators: true,
      timeControl: data.timeControl || "5 Minutes",
      moveTimer: data.moveTimer || "30 Seconds",
      chatEnabled: true,
    };

    tournaments.unshift(tournament);

    pushSystemFeed({
      text: `${host} created ${tournament.name}.`,
      type: "table",
    });

    broadcastTournaments();
  });

  socket.on("startTournament", (tournamentId) => {
    const tournament = tournaments.find((item) => item.id === tournamentId);

    if (!tournament || tournament.status !== "Waiting") return;

    const host = getSocketScreenName(socket);
    const isHost = tournament.host === host;
    const isDev = host === "JT";

    if (!isHost && !isDev) return;
    if (tournament.players.length < 2) return;

    generateTournamentBracket(tournament);

    pushSystemFeed({
      text: `${tournament.name} has started with ${tournament.players.length} players.`,
      type: "table",
    });

    broadcastTournaments();
  });

  socket.on("findMatch", (matchData = {}) => {
    removeFromMatchmaking(socket.id);

    const room = matchData.room || "beginner";
    const gameType = matchData.gameType || "Casual";

    const waitingIndex = matchmakingQueue.findIndex(
      (entry) =>
        entry.room === room &&
        entry.gameType === gameType &&
        entry.socketId !== socket.id
    );

    if (waitingIndex >= 0) {
      const opponentEntry = matchmakingQueue.splice(waitingIndex, 1)[0];
      const opponentSocket = io.sockets.sockets.get(opponentEntry.socketId);

      if (!opponentSocket) {
        socket.emit("matchmakingStatus", {
          searching: true,
          message: "Searching for opponent...",
        });

        matchmakingQueue.push({
          socketId: socket.id,
          room,
          gameType,
          startedAt: Date.now(),
        });

        return;
      }

      createMatchmakingTable(opponentSocket, socket, room, gameType);
      return;
    }

    matchmakingQueue.push({
      socketId: socket.id,
      room,
      gameType,
      startedAt: Date.now(),
    });

    socket.emit("matchmakingStatus", {
      searching: true,
      message: "Searching for opponent...",
    });
  });

  socket.on("cancelMatchmaking", () => {
    const removed = removeFromMatchmaking(socket.id);

    socket.emit("matchmakingStatus", {
      searching: false,
      message: removed ? "Search cancelled." : "Not currently searching.",
    });
  });

  socket.on("createTable", (tableData) => {
    removeFromMatchmaking(socket.id);
    const timeControl = tableData.timeControl || "5 Minutes";
    const moveTimer = tableData.moveTimer || "30 Seconds";

    const table = {
      id: Date.now().toString(),
      hostSocket: socket.id,
      blackSocket: null,
      room: tableData.room || "beginner",
      redPlayer: getSocketScreenName(socket),
      blackPlayer:
        tableData.opponentType === "Computer" ? "Computer_2" : "Open Seat",
      gameType: tableData.gameType || "Casual",
      timeControl,
      moveTimer,
      spectators: 0,
      status: tableData.opponentType === "Computer" ? "Playing" : "Waiting",
      allowSpectators: tableData.allowSpectators !== false,
      spectatorChat: tableData.spectatorChat !== false,
      ratedOnly:
        tableData.opponentType === "Computer"
          ? false
          : Boolean(tableData.ratedOnly),
      privateTable: Boolean(tableData.privateTable),
      opponentType: tableData.opponentType || "Human",
      computerSkill: tableData.computerSkill || "Beginner Bot",
      gameState: createGameState(timeControl, moveTimer),
    };

    activeTables.push(table);
    socket.join(table.id);

    socket.emit("tableCreated", table);
    socket.emit("gameStateUpdated", {
      tableId: table.id,
      gameState: table.gameState,
    });
    broadcastTableMessages(table);

    broadcastTables();
  });

  socket.on("joinTable", (tableId) => {
    removeFromMatchmaking(socket.id);
    const table = activeTables.find((item) => item.id === tableId);
    if (!table) return;
    if (table.opponentType === "Computer") return;
    if (table.blackPlayer !== "Open Seat") return;
    if (table.hostSocket === socket.id) return;

    table.blackPlayer = getSocketScreenName(socket);
    table.blackSocket = socket.id;
    table.status = "Playing";

    socket.join(table.id);

    socket.emit("tableJoined", table);
    io.to(table.id).emit("tableState", table);

    broadcastGame(table);
    broadcastTables();
  });

  socket.on("watchTable", (tableId) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table) return;
    if (!table.allowSpectators) return;

    table.spectators += 1;

    socket.join(table.id);

    socket.emit("tableWatched", table);
    socket.emit("gameStateUpdated", {
      tableId: table.id,
      gameState: table.gameState,
    });
    broadcastTableMessages(table);

    io.to(table.id).emit("tableState", table);
    broadcastTables();
  });

  socket.on("requestGameState", (tableId) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table) return;

    socket.emit("gameStateUpdated", {
      tableId: table.id,
      gameState: table.gameState,
    });
  });

  socket.on("requestTableMessages", (tableId) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table) return;

    socket.join(table.id);
    broadcastTableMessages(table);
  });

  socket.on("sendTableMessage", ({ tableId, text }) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table || !socket.data?.user) return;

    const isRedPlayer = table.redPlayer === socket.data.user.screenName;
    const isBlackPlayer = table.blackPlayer === socket.data.user.screenName;
    const isSpectator = !isRedPlayer && !isBlackPlayer;

    if (isSpectator && !table.spectatorChat) return;

    socket.join(table.id);

    addTableMessage(
      table,
      socket.data.user.screenName,
      text,
      "chat"
    );
  });

  socket.on("makeMove", ({ tableId, from, to }) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table || !table.gameState || table.gameState.winner) return;

    const gameState = table.gameState;

    const isRedPlayer = table.hostSocket === socket.id;
    const isBlackPlayer = table.blackSocket === socket.id;

    if (gameState.turn === "red" && !isRedPlayer) return;
    if (
      gameState.turn === "black" &&
      table.opponentType !== "Computer" &&
      !isBlackPlayer
    ) {
      return;
    }

    if (gameState.turn === "black" && table.opponentType === "Computer") {
      return;
    }

    const legalMoves = getLegalMoves(
      gameState.board,
      gameState.turn,
      gameState.forcedPiece,
      from.row,
      from.col
    );

    const legalMove = legalMoves.find(
      (move) => move.row === to.row && move.col === to.col
    );

    if (!legalMove) {
      console.log("Illegal move blocked:", socket.id, from, to);
      return;
    }

    const newBoard = cloneBoard(gameState.board);
    const movingPiece = newBoard[from.row][from.col];
    const wasKing = Boolean(movingPiece?.king);

    newBoard[to.row][to.col] = movingPiece;
    newBoard[from.row][from.col] = null;

    let performedCapture = false;

    if (legalMove.capture) {
      performedCapture = true;

      const capturedPiece =
        newBoard[legalMove.capture.row][legalMove.capture.col];

      if (capturedPiece?.color === "red") {
        gameState.redCaptured += 1;
      }

      if (capturedPiece?.color === "black") {
        gameState.blackCaptured += 1;
      }

      newBoard[legalMove.capture.row][legalMove.capture.col] = null;
    }

    if (movingPiece?.color === "red" && to.row === 0) {
      movingPiece.king = true;
    }

    if (movingPiece?.color === "black" && to.row === 7) {
      movingPiece.king = true;
    }

    const promoted = Boolean(movingPiece?.king && !wasKing);

    gameState.lastMove = {
      from,
      to,
      capture: legalMove.capture || null,
      promoted,
    };

    gameState.moveHistory.push({
      number: gameState.moveHistory.length + 1,
      color: movingPiece?.color || gameState.turn,
      from,
      to,
      capture: legalMove.capture || null,
      promoted,
      notation: makeMoveNotation(movingPiece, from, to, legalMove, promoted),
    });

    gameState.board = newBoard;

    if (performedCapture) {
      const additionalCaptures = getCaptureMoves(newBoard, to.row, to.col);

      if (additionalCaptures.length > 0) {
        gameState.forcedPiece = { row: to.row, col: to.col };
        gameState.multiJumpActive = true;

        broadcastGame(table);
        return;
      }
    }

    gameState.forcedPiece = null;
    gameState.multiJumpActive = false;

    const winner = checkWinner(newBoard);

    if (winner) {
      gameState.winner = winner;
      table.status = "Finished";

      applyRankedResult(table, winner, "checkers");
      saveCompletedMatch(table, winner, "checkers");

      io.to(table.id).emit("tableState", table);
      broadcastTables();
      broadcastGame(table);
      return;
    }

    gameState.turn = gameState.turn === "red" ? "black" : "red";

    gameState.moveTimeLeft = gameState.moveTimerStart;

    broadcastGame(table);

    maybeScheduleBotMove(table);
  });


  socket.on("resignGame", (tableId) => {
    const table = activeTables.find((t) => t.id === tableId);

    if (!table || !table.gameState || table.gameState.winner) return;

    const isRedPlayer = table.hostSocket === socket.id;
    const isBlackPlayer = table.blackSocket === socket.id;

    if (!isRedPlayer && !isBlackPlayer) return;

    const winner = isRedPlayer ? "black" : "red";
    const resignedColor = isRedPlayer ? "red" : "black";

    table.gameState.winner = winner;
    table.gameState.resignedColor = resignedColor;
    table.gameState.timeoutWinner = null;

    applyRankedResult(table, winner, "resign");
    saveCompletedMatch(table, winner, "resign");

    table.gameState.moveHistory.push({
      number: table.gameState.moveHistory.length + 1,
      color: resignedColor,
      from: null,
      to: null,
      capture: null,
      promoted: false,
      notation: `${resignedColor.toUpperCase()} resigned. ${winner.toUpperCase()} wins.`,
    });

    table.status = "Finished";

    io.to(table.id).emit("tableState", table);

    broadcastTables();
    broadcastGame(table);
  });

  socket.on("resetGame", (tableId) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table) return;
    if (table.hostSocket !== socket.id) return;

    const hadHumanOpponent =
      table.opponentType !== "Computer" &&
      table.blackPlayer !== "Open Seat" &&
      table.blackSocket;

    if (hadHumanOpponent) {
      const oldRedPlayer = table.redPlayer;
      const oldRedSocket = table.hostSocket;
      const oldBlackPlayer = table.blackPlayer;
      const oldBlackSocket = table.blackSocket;

      table.redPlayer = oldBlackPlayer;
      table.hostSocket = oldBlackSocket;
      table.blackPlayer = oldRedPlayer;
      table.blackSocket = oldRedSocket;

      io.to(table.hostSocket).emit("roleUpdated", {
        tableId: table.id,
        role: "red",
      });

      io.to(table.blackSocket).emit("roleUpdated", {
        tableId: table.id,
        role: "black",
      });

      addTableMessage(
        table,
        "System",
        "Rematch started. Players switched sides.",
        "system"
      );
    } else {
      addTableMessage(table, "System", "Rematch started.", "system");
    }

    table.gameState = createGameState(table.timeControl, table.moveTimer);
    table.status = table.blackPlayer === "Open Seat" ? "Waiting" : "Playing";

    io.to(table.id).emit("tableState", table);
    broadcastTables();
    broadcastGame(table);
    broadcastTableMessages(table);
  });

  socket.on("leaveTable", (tableId) => {
    const table = activeTables.find((item) => item.id === tableId);
    if (!table) return;

    socket.leave(table.id);

    if (table.blackSocket === socket.id) {
      table.blackSocket = null;
      table.blackPlayer = "Open Seat";
      table.status = "Waiting";
    }

    io.to(table.id).emit("tableState", table);
    broadcastTables();
  });

  socket.on("disconnect", () => {
    connectedPlayers.delete(socket.id);
    broadcastLivePlayers();
    console.log("User disconnected:", socket.id);

    removeFromMatchmaking(socket.id);

    const remainingTables = activeTables.filter(
      (table) => table.hostSocket !== socket.id
    );

    for (const table of remainingTables) {
      if (table.blackSocket === socket.id) {
        table.blackSocket = null;
        table.blackPlayer = "Open Seat";
        table.status = "Waiting";
      }
    }

    activeTables.length = 0;
    remainingTables.forEach((table) => activeTables.push(table));

    broadcastTables();
  });
});


const LIVE_LOBBY_PULSE_MS = 5000;

setInterval(() => {
  broadcastLobbyRealtime();
}, LIVE_LOBBY_PULSE_MS);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
  console.log(`CHEXKERS server running on port ${PORT}`);
  console.log(`Allowed client origins: ${CLIENT_ORIGINS.join(", ")}`);
});
