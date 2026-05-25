"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:4000";

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
});

type RoomId = "beginner" | "intermediate" | "advanced" | "expert" | "masters";
type Color = "red" | "black";

type Piece = {
  color: Color;
  king: boolean;
} | null;

type Position = {
  row: number;
  col: number;
};

type Move = {
  row: number;
  col: number;
  capture?: Position;
};

type LastMove = {
  from: Position;
  to: Position;
  capture?: Position | null;
  promoted?: boolean;
} | null;

type MoveHistoryEntry = {
  number: number;
  color: Color;
  from: Position | null;
  to: Position | null;
  capture?: Position | null;
  promoted?: boolean;
  notation: string;
};

type AnalysisSnapshot = {
  index: number;
  label: string;
  board: Piece[][];
  move: MoveHistoryEntry | null;
};

type GameState = {
  board: Piece[][];
  turn: Color;
  winner: Color | null;
  forcedPiece: Position | null;
  redCaptured: number;
  blackCaptured: number;
  multiJumpActive?: boolean;

  redTimeLeft: number | null;
  blackTimeLeft: number | null;
  moveTimeLeft: number | null;
  moveTimerStart: number | null;
  timeoutWinner?: Color | null;
  resignedColor?: Color | null;
  ratingApplied?: boolean;
  ratingResult?: {
    ranked: boolean;
    reason: string;
    winnerColor: Color;
    winnerScreenName: string;
    loserScreenName: string;
    winnerDelta: number;
    loserDelta: number;
    winnerRating: number;
    loserRating: number;
  } | null;
  lastMove?: LastMove;
  moveHistory?: MoveHistoryEntry[];
};

type Table = {
  id: string;
  room: RoomId;
  hostSocket?: string;
  blackSocket?: string | null;
  redPlayer: string;
  blackPlayer: string;
  gameType: string;
  timeControl: string;
  moveTimer: string;
  spectators: number;
  status: string;
  allowSpectators: boolean;
  spectatorChat: boolean;
  ratedOnly: boolean;
  privateTable: boolean;
  opponentType: "Human" | "Computer";
  computerSkill: string;
  gameState?: GameState;
};

type Player = {
  name: string;
  rating: number;
};

type CurrentUser = {
  id: string;
  email: string;
  screenName: string;
  rating: number;
  wins: number;
  losses: number;
  createdAt: string;
};

type LeaderboardPlayer = {
  id: string;
  email: string;
  screenName: string;
  rating: number;
  wins: number;
  losses: number;
  createdAt: string;
};

type LivePlayer = {
  screenName: string;
  rating: number;
  connectedAt?: number;
};

type MatchRecord = {
  id: string;
  tableId: string;
  room: string;
  gameType: string;
  reason: string;
  redPlayer: string;
  blackPlayer: string;
  winnerColor: Color;
  winnerName: string;
  loserName: string;
  redCaptured: number;
  blackCaptured: number;
  moveCount: number;
  ratingResult?: {
    winnerDelta: number;
    loserDelta: number;
    winnerRating: number;
    loserRating: number;
  } | null;
  createdAt: string;
};

type PlayerProfile = {
  id: string;
  email: string;
  screenName: string;
  rating: number;
  wins: number;
  losses: number;
  createdAt: string;
  matchesPlayed: number;
  winRate: number;
  recentMatches?: MatchRecord[];
};

type LobbyMessage = {
  id: string;
  sender: string;
  text: string;
  createdAt: number;
  type: "chat" | "system";
};

type SystemFeedItem = {
  id: string;
  text: string;
  createdAt: number;
  type: "system" | "account" | "ranked" | "matchmaking" | "table";
};

type TournamentPlayer = {
  screenName: string;
  rating: number;
  joinedAt: number;
  eliminated: boolean;
  wins: number;
};

type TournamentMatch = {
  id: string;
  round: number;
  matchNumber: number;
  player1: TournamentPlayer | null;
  player2: TournamentPlayer | null;
  winner: TournamentPlayer | null;
  tableId: string | null;
  status: "Waiting" | "Bye" | "Playing" | "Finished";
};

type TournamentRound = {
  round: number;
  name: string;
  matches: TournamentMatch[];
};

type Tournament = {
  id: string;
  name: string;
  type: "Casual" | "Ranked";
  format: string;
  host: string;
  maxPlayers: number;
  status: "Waiting" | "In Progress" | "Finished";
  createdAt: number;
  startsAt: number;
  round: number;
  players: TournamentPlayer[];
  bracket: TournamentRound[];
  winner: TournamentPlayer | null;
  allowSpectators: boolean;
  timeControl: string;
  moveTimer: string;
  chatEnabled: boolean;
};


const players: Player[] = [
  { name: "RedCirclePro", rating: 2210 },
  { name: "CrownMaster", rating: 2144 },
  { name: "PurpleAce", rating: 1982 },
  { name: "CheckerPro", rating: 1940 },
  { name: "BoardLord", rating: 1811 },
  { name: "JumpKing", rating: 1672 },
  { name: "Keyblade300", rating: 1500 },
  { name: "NewPlayer42", rating: 1500 },
  { name: "GuestPlayer", rating: 1500 },
  { name: "Computer_2", rating: 1500 },
];

const rooms: { id: RoomId; name: string; color: string; population: number }[] =
  [
    { id: "beginner", name: "Beginner", color: "text-sky-400", population: 48 },
    {
      id: "intermediate",
      name: "Intermediate",
      color: "text-green-500",
      population: 31,
    },
    {
      id: "advanced",
      name: "Advanced",
      color: "text-orange-500",
      population: 19,
    },
    { id: "expert", name: "Expert", color: "text-purple-500", population: 12 },
    { id: "masters", name: "Masters", color: "text-red-500", population: 6 },
  ];

function createEmptyGameState(): GameState {
  return {
    board: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null)),
    turn: "red",
    winner: null,
    forcedPiece: null,
    redCaptured: 0,
    blackCaptured: 0,
    multiJumpActive: false,

    redTimeLeft: 300,
    blackTimeLeft: 300,
    moveTimeLeft: 30,
    moveTimerStart: 30,
    timeoutWinner: null,
    resignedColor: null,
    ratingApplied: false,
    ratingResult: null,
    lastMove: null,
    moveHistory: [],
  };
}

function getRating(name: string) {
  return players.find((player) => player.name === name)?.rating ?? 1500;
}

function formatClock(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return "âˆž";
  }

  const safeSeconds = Math.max(0, seconds);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;

  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function isLowTime(seconds: number | null | undefined) {
  return seconds !== null && seconds !== undefined && seconds <= 10;
}

function playTone(
  audioContext: AudioContext,
  frequency: number,
  duration: number,
  type: OscillatorType = "sine",
  volume = 0.05
) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(
    0.001,
    audioContext.currentTime + duration
  );

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function playMoveSound(audioContext: AudioContext) {
  playTone(audioContext, 440, 0.08, "triangle", 0.045);
}

function playJumpSound(audioContext: AudioContext) {
  playTone(audioContext, 180, 0.1, "square", 0.045);
  setTimeout(() => playTone(audioContext, 260, 0.08, "square", 0.035), 55);
}

function playKingSound(audioContext: AudioContext) {
  playTone(audioContext, 523, 0.1, "triangle", 0.045);
  setTimeout(() => playTone(audioContext, 659, 0.1, "triangle", 0.04), 90);
  setTimeout(() => playTone(audioContext, 784, 0.14, "triangle", 0.035), 180);
}

function playWinSound(audioContext: AudioContext) {
  playTone(audioContext, 392, 0.12, "triangle", 0.045);
  setTimeout(() => playTone(audioContext, 523, 0.12, "triangle", 0.04), 120);
  setTimeout(() => playTone(audioContext, 659, 0.18, "triangle", 0.035), 240);
}

function positionsMatch(a?: Position | null, b?: Position | null) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

function cloneClientBoard(board: Piece[][]) {
  return board.map((row) =>
    row.map((piece) => (piece ? { ...piece } : null))
  );
}

function createStartingBoard(): Piece[][] {
  const board: Piece[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null)
  );

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = {
          color: "black",
          king: false,
        };
      }
    }
  }

  for (let row = 5; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) {
        board[row][col] = {
          color: "red",
          king: false,
        };
      }
    }
  }

  return board;
}

function buildAnalysisSnapshots(moveHistory: MoveHistoryEntry[] = []) {
  const snapshots: AnalysisSnapshot[] = [
    {
      index: 0,
      label: "Start",
      board: createStartingBoard(),
      move: null,
    },
  ];

  let board = createStartingBoard();

  moveHistory.forEach((move, index) => {
    if (!move.from || !move.to) return;

    const nextBoard = cloneClientBoard(board);
    const movingPiece = nextBoard[move.from.row]?.[move.from.col];

    if (!movingPiece) return;

    nextBoard[move.to.row][move.to.col] = movingPiece;
    nextBoard[move.from.row][move.from.col] = null;

    if (move.capture) {
      nextBoard[move.capture.row][move.capture.col] = null;
    }

    if (move.promoted) {
      movingPiece.king = true;
    }

    board = nextBoard;

    snapshots.push({
      index: index + 1,
      label: `Move ${index + 1}`,
      board: cloneClientBoard(board),
      move,
    });
  });

  return snapshots;
}

function RankCircle({
  rating,
  small = false,
}: {
  rating: number;
  small?: boolean;
}) {
  let color = "#0ea5e9";
  let borderWidth = small ? 2 : 3;
  let innerScale = 0.68;

  if (rating >= 2100) {
    color = "#ef4444";
    innerScale = 0;
    borderWidth = 0;
  } else if (rating >= 1900) {
    color = "#a855f7";
    innerScale = 0.24;
    borderWidth = small ? 5 : 6;
  } else if (rating >= 1750) {
    color = "#f97316";
    innerScale = 0.42;
    borderWidth = small ? 4 : 5;
  } else if (rating >= 1600) {
    color = "#22c55e";
    innerScale = 0.55;
    borderWidth = small ? 3 : 4;
  }

  const size = small ? 12 : 16;
  const innerSize = Math.round(size * innerScale);

  return (
    <span
      className="relative inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        border: borderWidth > 0 ? `${borderWidth}px solid ${color}` : "none",
        boxShadow: rating >= 2100 ? "0 0 6px rgba(239, 68, 68, 0.8)" : "none",
      }}
    >
      {innerScale > 0 && (
        <span
          className="absolute rounded-full bg-[#211512]"
          style={{
            width: innerSize,
            height: innerSize,
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      )}
    </span>
  );
}

function MiniBoard() {
  return (
    <div className="grid grid-cols-4 grid-rows-4 h-20 w-20 border border-amber-900 shadow-inner">
      {Array.from({ length: 16 }).map((_, i) => {
        const dark = (Math.floor(i / 4) + i) % 2 !== 0;
        const hasBlack = [1, 3, 4, 6].includes(i);
        const hasRed = [9, 11, 12, 14].includes(i);

        return (
          <div
            key={i}
            className={`flex items-center justify-center ${
              dark ? "bg-[#5b2f1f]" : "bg-[#c08a5a]"
            }`}
          >
            {dark && hasBlack && (
              <div className="h-3 w-3 rounded-full bg-zinc-900 border border-zinc-600" />
            )}

            {dark && hasRed && (
              <div className="h-3 w-3 rounded-full bg-red-600 border border-red-300" />
            )}
          </div>
        );
      })}
    </div>
  );
}

function PlayerSeat({ name, side }: { name: string; side: "red" | "black" }) {
  const open = name === "Open Seat";
  const rating = getRating(name);
  const avatarLetter = open ? "+" : name.charAt(0).toUpperCase();

  return (
    <div className="text-center w-24">
      <div
        className={`mx-auto mb-1 h-10 w-10 rounded-full flex items-center justify-center border text-sm font-bold ${
          open
            ? "bg-zinc-700 border-zinc-500 text-white"
            : side === "red"
            ? "bg-red-700 border-red-400 text-white"
            : "bg-zinc-800 border-zinc-500 text-white"
        }`}
      >
        {avatarLetter}
      </div>

      <div className="text-xs truncate flex items-center justify-center gap-1">
        {!open && <RankCircle rating={rating} small />}
        <span>{name}</span>
      </div>
    </div>
  );
}



async function authRequest(
  endpoint: "/api/register" | "/api/login",
  payload: {
    email: string;
    screenName?: string;
    password: string;
  }
) {
  const response = await fetch(`${SERVER_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    throw new Error(
      "Account server did not return JSON. Make sure BACKEND is running on port 4000 and server.js was replaced/restarted."
    );
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Account request failed.");
  }

  return data.user as CurrentUser;
}

async function fetchLeaderboard() {
  const response = await fetch(`${SERVER_URL}/api/leaderboard`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load leaderboard.");
  }

  return data.players as LeaderboardPlayer[];
}

async function fetchPlayerProfile(screenName: string) {
  const response = await fetch(
    `${SERVER_URL}/api/profile/${encodeURIComponent(screenName)}`
  );
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load profile.");
  }

  return data.profile as PlayerProfile;
}

function BoardEffects() {
  return (
    <style jsx global>{`
      @keyframes chexPiecePop {
        0% {
          transform: scale(0.85);
          opacity: 0.65;
        }
        65% {
          transform: scale(1.14);
          opacity: 1;
        }
        100% {
          transform: scale(1);
          opacity: 1;
        }
      }

      @keyframes chexLandingPulse {
        0% {
          box-shadow: inset 0 0 0 0 rgba(96, 165, 250, 0.75);
        }
        50% {
          box-shadow: inset 0 0 24px 8px rgba(96, 165, 250, 0.32);
        }
        100% {
          box-shadow: inset 0 0 0 0 rgba(96, 165, 250, 0);
        }
      }

      @keyframes chexCaptureBurst {
        0% {
          transform: scale(0.35);
          opacity: 0.95;
        }
        70% {
          transform: scale(1.45);
          opacity: 0.45;
        }
        100% {
          transform: scale(1.9);
          opacity: 0;
        }
      }

      @keyframes chexKingBurst {
        0% {
          transform: scale(0.3) rotate(0deg);
          opacity: 0;
        }
        35% {
          transform: scale(1.2) rotate(10deg);
          opacity: 1;
        }
        100% {
          transform: scale(1) rotate(0deg);
          opacity: 1;
        }
      }

      @keyframes chexMoveTrail {
        0% {
          opacity: 0;
          transform: scale(0.7);
        }
        45% {
          opacity: 0.85;
          transform: scale(1.1);
        }
        100% {
          opacity: 0.28;
          transform: scale(1);
        }
      }

      .chex-piece-pop {
        animation: chexPiecePop 220ms ease-out;
      }

      .chex-landing-pulse {
        animation: chexLandingPulse 650ms ease-out;
      }

      .chex-capture-burst::after {
        content: "";
        position: absolute;
        inset: 18%;
        border-radius: 9999px;
        border: 4px solid rgba(248, 113, 113, 0.95);
        animation: chexCaptureBurst 520ms ease-out forwards;
        pointer-events: none;
      }

      .chex-king-burst {
        animation: chexKingBurst 520ms ease-out;
      }

      .chex-move-trail {
        animation: chexMoveTrail 600ms ease-out forwards;
      }
`}</style>
  );
}


function CapturedPieceTray({
  label,
  color,
  count,
}: {
  label: string;
  color: Color;
  count: number;
}) {
  return (
    <div className="rounded-lg border border-[#3a2721] bg-[#1b120f] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-zinc-400 uppercase tracking-wide">
          {label}
        </span>

        <span className="text-sm font-bold text-amber-300">
          {count}
        </span>
      </div>

      <div className="grid grid-cols-6 gap-1 min-h-[34px]">
        {Array.from({ length: Math.max(1, count) }).map((_, index) => {
          const visible = index < count;

          return (
            <div
              key={`${label}-${index}`}
              className={`h-6 w-6 rounded-full border-2 transition ${
                visible
                  ? color === "red"
                    ? "bg-red-600 border-red-300 shadow-[0_0_8px_rgba(248,113,113,0.5)]"
                    : "bg-zinc-900 border-zinc-500 shadow-[0_0_8px_rgba(113,113,122,0.5)]"
                  : "bg-transparent border-transparent"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const [serverStatus, setServerStatus] = useState("Connecting...");
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const currentUserRef = useRef<CurrentUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authScreenName, setAuthScreenName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [isMatchmaking, setIsMatchmaking] = useState(false);
  const [matchmakingMessage, setMatchmakingMessage] = useState("");
  const [queueType, setQueueType] = useState<"Casual" | "Ranked">("Casual");
  const [leaderboardPlayers, setLeaderboardPlayers] = useState<LeaderboardPlayer[]>([]);
  const [livePlayers, setLivePlayers] = useState<LivePlayer[]>([]);
  const [lobbyMessages, setLobbyMessages] = useState<LobbyMessage[]>([]);
  const [systemFeedItems, setSystemFeedItems] = useState<SystemFeedItem[]>([]);
  const [lobbyChatText, setLobbyChatText] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<PlayerProfile | null>(null);
  const [profileError, setProfileError] = useState("");
  const [reconnectMessage, setReconnectMessage] = useState("");
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [showCreateTournament, setShowCreateTournament] = useState(false);
  const [newTournamentName, setNewTournamentName] = useState("Community Cup");
  const [newTournamentType, setNewTournamentType] = useState<"Casual" | "Ranked">("Casual");
  const [newTournamentMaxPlayers, setNewTournamentMaxPlayers] = useState(8);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<RoomId>("beginner");
  const [tables, setTables] = useState<Table[]>([]);
  const [currentTable, setCurrentTable] = useState<Table | null>(null);
  const [gameState, setGameState] = useState<GameState>(createEmptyGameState);
  const [selected, setSelected] = useState<Position | null>(null);
  const [analysisMoveIndex, setAnalysisMoveIndex] = useState<number | null>(null);
  const [dragged, setDragged] = useState<Position | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastMoveKeyRef = useRef<string>("");
  const lastWinnerRef = useRef<Color | null>(null);
  const selectionClearedMoveKeyRef = useRef<string>("");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [playerRole, setPlayerRole] = useState<
    "red" | "black" | "spectator" | null
  >(null);
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);

  const [gameType, setGameType] = useState("Casual");
  const [timeControl, setTimeControl] = useState("5 Minutes");
  const [moveTimer, setMoveTimer] = useState("30 Seconds");
  const [opponentType, setOpponentType] = useState<"Human" | "Computer">(
    "Human"
  );
  const [computerSkill, setComputerSkill] = useState("Beginner Bot");
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [spectatorChat, setSpectatorChat] = useState(true);
  const [ratedOnly, setRatedOnly] = useState(false);
  const [privateTable, setPrivateTable] = useState(false);

  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  useEffect(() => {
    const updateMobileLayout = () => {
      const mobile = window.innerWidth <= 900;
      setIsMobileLayout(mobile);
      setIsMobileLandscape(mobile && window.innerWidth > window.innerHeight);
    };

    updateMobileLayout();
    window.addEventListener("resize", updateMobileLayout);
    window.addEventListener("orientationchange", updateMobileLayout);

    return () => {
      window.removeEventListener("resize", updateMobileLayout);
      window.removeEventListener("orientationchange", updateMobileLayout);
    };
  }, []);

  useEffect(() => {
    const savedUser = window.localStorage.getItem("chexkersUser");

    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as CurrentUser;
        setCurrentUser(parsedUser);
        socket.emit("setCurrentUser", parsedUser);
        socket.emit("requestReconnect");
        loadLeaderboard();
      } catch {
        window.localStorage.removeItem("chexkersUser");
      }
    }

    if (socket.connected) {
      setServerStatus("Connected");
    }

    loadLeaderboard();

    const leaderboardRefresh = window.setInterval(() => {
      loadLeaderboard();
    }, 10000);

    socket.emit("joinLobby");

    socket.on("connect", () => {
      setServerStatus("Connected");

      const savedUser = window.localStorage.getItem("chexkersUser");

      if (savedUser) {
        try {
          socket.emit("setCurrentUser", JSON.parse(savedUser));
          socket.emit("requestReconnect");
        } catch {
          window.localStorage.removeItem("chexkersUser");
        }
      }

      socket.emit("joinLobby");
    });

    socket.on("disconnect", () => {
      setServerStatus("Connecting...");
    });

    socket.on("tablesUpdated", (updatedTables: Table[]) => {
      setTables(updatedTables);
    });

    socket.on("tableCreated", (table: Table) => {
      setCurrentTable(table);
      setPlayerRole("red");
      socket.emit("requestGameState", table.id);
    });

    socket.on("tableJoined", (table: Table) => {
      setCurrentTable(table);
      setPlayerRole("black");
      socket.emit("requestGameState", table.id);
    });

    socket.on("tableWatched", (table: Table) => {
      setCurrentTable(table);
      setPlayerRole("spectator");
      socket.emit("requestGameState", table.id);
    });

    socket.on("tableState", (table: Table) => {
      setCurrentTable(table);
    });

    socket.on(
      "reconnectedToTable",
      ({
        table,
        role,
      }: {
        table: Table;
        role: "red" | "black" | "spectator";
      }) => {
        setCurrentTable(table);
        setPlayerRole(role);
        setReconnectMessage(`Reconnected as ${role}.`);
        socket.emit("requestGameState", table.id);
      }
    );

    socket.on(
      "reconnectStatus",
      (status: { success: boolean; message: string }) => {
        if (status.success) {
          setReconnectMessage(status.message);
        }
      }
    );

    socket.on(
      "matchmakingStatus",
      (status: { searching: boolean; message: string }) => {
        setIsMatchmaking(status.searching);
        setMatchmakingMessage(status.message || "");
      }
    );

    socket.on(
      "matchFound",
      ({
        table,
        role,
      }: {
        table: Table;
        role: "red" | "black";
      }) => {
        setIsMatchmaking(false);
        setMatchmakingMessage("Match found!");
        setCurrentTable(table);
        setPlayerRole(role);
        socket.emit("requestGameState", table.id);
      }
    );

    socket.on("lobbyMessagesUpdated", (messages: LobbyMessage[]) => {
      setLobbyMessages(messages);
    });

    socket.on("systemFeedUpdated", (items: SystemFeedItem[]) => {
      setSystemFeedItems(items);
    });

    socket.on("leaderboardUpdated", (players: LeaderboardPlayer[]) => {
      setLeaderboardPlayers(players);
    });

    socket.on("livePlayersUpdated", (players: LivePlayer[]) => {
      setLivePlayers(players);
    });

    socket.on("tournamentsUpdated", (updatedTournaments: Tournament[]) => {
      setTournaments(updatedTournaments);
    });

    socket.on(
      "gameStateUpdated",
      ({
        gameState: updatedGameState,
      }: {
        tableId: string;
        gameState: GameState;
      }) => {
        if (soundEnabled) {
          const audioContext = getAudioContext();

          if (audioContext) {
            const lastMove = updatedGameState.lastMove;
            const moveKey = lastMove
              ? `${lastMove.from.row},${lastMove.from.col}-${lastMove.to.row},${lastMove.to.col}-${lastMove.capture?.row ?? "x"},${lastMove.capture?.col ?? "x"}-${lastMove.promoted ? "k" : ""}`
              : "";

            if (moveKey && moveKey !== lastMoveKeyRef.current) {
              if (lastMove?.promoted) {
                playKingSound(audioContext);
              } else if (lastMove?.capture) {
                playJumpSound(audioContext);
              } else {
                playMoveSound(audioContext);
              }

              lastMoveKeyRef.current = moveKey;
            }

            if (
              updatedGameState.winner &&
              updatedGameState.winner !== lastWinnerRef.current
            ) {
              playWinSound(audioContext);
              lastWinnerRef.current = updatedGameState.winner;
            }
          }
        }

        const ratingResult = updatedGameState.ratingResult;
        const activeUser = currentUserRef.current;

        if (ratingResult && activeUser) {
          let updatedUser: CurrentUser | null = null;

          if (ratingResult.winnerScreenName === activeUser.screenName) {
            updatedUser = {
              ...activeUser,
              rating: ratingResult.winnerRating,
              wins: activeUser.wins + 1,
            };
          }

          if (ratingResult.loserScreenName === activeUser.screenName) {
            updatedUser = {
              ...activeUser,
              rating: ratingResult.loserRating,
              losses: activeUser.losses + 1,
            };
          }

          if (updatedUser) {
            currentUserRef.current = updatedUser;
            setCurrentUser(updatedUser);
            window.localStorage.setItem("chexkersUser", JSON.stringify(updatedUser));
            loadLeaderboard();
          }
        }

        if (
          analysisMoveIndex !== null &&
          analysisMoveIndex > (updatedGameState.moveHistory || []).length
        ) {
          setAnalysisMoveIndex(null);
        }

        setGameState(updatedGameState);

        const incomingMove = updatedGameState.lastMove;
        const incomingMoveKey = incomingMove
          ? `${incomingMove.from.row},${incomingMove.from.col}-${incomingMove.to.row},${incomingMove.to.col}-${incomingMove.capture?.row ?? "x"},${incomingMove.capture?.col ?? "x"}-${incomingMove.promoted ? "k" : ""}`
          : "";

        if (
          incomingMoveKey &&
          incomingMoveKey !== selectionClearedMoveKeyRef.current
        ) {
          selectionClearedMoveKeyRef.current = incomingMoveKey;
          setSelected(null);
          setDragged(null);
        }

        if (updatedGameState.winner) {
          setSelected(null);
          setDragged(null);
        }
      }
    );

    return () => {
      window.clearInterval(leaderboardRefresh);

      socket.off("connect");
      socket.off("disconnect");
      socket.off("tablesUpdated");
      socket.off("tableCreated");
      socket.off("tableJoined");
      socket.off("tableWatched");
      socket.off("tableState");
      socket.off("reconnectedToTable");
      socket.off("reconnectStatus");
      socket.off("matchmakingStatus");
      socket.off("matchFound");
      socket.off("lobbyMessagesUpdated");
      socket.off("systemFeedUpdated");
      socket.off("leaderboardUpdated");
      socket.off("livePlayersUpdated");
      socket.off("tournamentsUpdated");
      socket.off("gameStateUpdated");
    };
  }, []);

  const visibleTables = useMemo(() => {
    return tables.filter((table) => table.room === activeRoom);
  }, [tables, activeRoom]);

  const selectedTournament = useMemo(() => {
    if (!selectedTournamentId) return null;

    return (
      tournaments.find((tournament) => tournament.id === selectedTournamentId) ||
      null
    );
  }, [tournaments, selectedTournamentId]);

  const analysisSnapshots = useMemo(() => {
    return buildAnalysisSnapshots(gameState.moveHistory || []);
  }, [gameState.moveHistory]);

  const analysisSnapshot = useMemo(() => {
    if (analysisMoveIndex === null) return null;

    return (
      analysisSnapshots.find(
        (snapshot) => snapshot.index === analysisMoveIndex
      ) || null
    );
  }, [analysisSnapshots, analysisMoveIndex]);

  const displayBoard = analysisSnapshot?.board || gameState.board;
  const reviewingMove = analysisMoveIndex !== null;

  function getAudioContext() {
    if (typeof window === "undefined") return null;

    if (!audioContextRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (!AudioContextClass) return null;

      audioContextRef.current = new AudioContextClass();
    }

    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }

  function getDirections(piece: Piece) {
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

  function inBounds(row: number, col: number) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function getMoves(board: Piece[][], row: number, col: number) {
    const piece = board[row]?.[col];

    if (!piece) return [];

    const moves: Move[] = [];

    for (const [dr, dc] of getDirections(piece)) {
      const moveRow = row + dr;
      const moveCol = col + dc;

      if (
        inBounds(moveRow, moveCol) &&
        board[moveRow][moveCol] === null
      ) {
        moves.push({
          row: moveRow,
          col: moveCol,
        });
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
          capture: {
            row: moveRow,
            col: moveCol,
          },
        });
      }
    }

    return moves;
  }

  function getAllCaptures(board: Piece[][], color: Color) {
    const captures: Position[] = [];

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = board[row][col];

        if (!piece || piece.color !== color) continue;

        if (getMoves(board, row, col).some((move) => move.capture)) {
          captures.push({ row, col });
        }
      }
    }

    return captures;
  }

  function getLegalMoves(row: number, col: number) {
    const piece = displayBoard[row]?.[col];

    if (!piece || piece.color !== gameState.turn) return [];

    if (playerRole !== gameState.turn) return [];

    if (
      gameState.forcedPiece &&
      (gameState.forcedPiece.row !== row || gameState.forcedPiece.col !== col)
    ) {
      return [];
    }

    const moves = getMoves(displayBoard, row, col);
    const forcedCaptures = getAllCaptures(displayBoard, gameState.turn);

    if (forcedCaptures.length > 0 || gameState.forcedPiece) {
      return moves.filter((move) => move.capture);
    }

    return moves;
  }

  function getForcedCapturePieces() {
    if (gameState.forcedPiece) {
      return [gameState.forcedPiece];
    }

    if (playerRole !== gameState.turn) {
      return [];
    }

    return getAllCaptures(displayBoard, gameState.turn);
  }

  function isForcedPiece(row: number, col: number) {
    return getForcedCapturePieces().some(
      (piece) => piece.row === row && piece.col === col
    );
  }

  function isLegalTarget(row: number, col: number) {
    if (!selected) return null;

    return getLegalMoves(selected.row, selected.col).find(
      (move) => move.row === row && move.col === col
    );
  }

  async function loadLeaderboard() {
    try {
      const players = await fetchLeaderboard();
      setLeaderboardPlayers(players);

      const activeUser = currentUserRef.current;

      if (activeUser) {
        const freshUser = players.find(
          (player) =>
            player.screenName.toLowerCase() ===
            activeUser.screenName.toLowerCase()
        );

        if (freshUser && freshUser.rating !== activeUser.rating) {
          const updatedUser = {
            ...activeUser,
            rating: freshUser.rating,
            wins: freshUser.wins,
            losses: freshUser.losses,
          };

          currentUserRef.current = updatedUser;
          setCurrentUser(updatedUser);
          window.localStorage.setItem("chexkersUser", JSON.stringify(updatedUser));
        }
      }
    } catch {
      setLeaderboardPlayers([]);
    }
  }

  async function submitAuth() {
    setAuthError("");
    setAuthLoading(true);

    try {
      const user = await authRequest(
        authMode === "register" ? "/api/register" : "/api/login",
        {
          email: authEmail,
          screenName: authScreenName,
          password: authPassword,
        }
      );

      setCurrentUser(user);
      window.localStorage.setItem("chexkersUser", JSON.stringify(user));
      socket.emit("setCurrentUser", user);
      loadLeaderboard();

      setAuthPassword("");
      setAuthError("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Account error.");
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    setCurrentUser(null);
    setAuthPassword("");
    setAuthError("");
    window.localStorage.removeItem("chexkersUser");
    socket.emit("setCurrentUser", null);
  }

  async function openPlayerProfile(screenName: string) {
    setProfileError("");

    try {
      const profile = await fetchPlayerProfile(screenName);
      setSelectedProfile(profile);
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : "Could not load profile."
      );
    }
  }

  function joinTournament(tournamentId: string) {
    socket.emit("joinTournament", tournamentId);
  }

  function leaveTournament(tournamentId: string) {
    socket.emit("leaveTournament", tournamentId);
  }

  function startTournament(tournamentId: string) {
    socket.emit("startTournament", tournamentId);
  }

  function createTournament() {
    socket.emit("createTournament", {
      name: newTournamentName,
      type: newTournamentType,
      maxPlayers: newTournamentMaxPlayers,
      timeControl: "5 Minutes",
      moveTimer: "30 Seconds",
    });

    setShowCreateTournament(false);
  }

  function requestReconnect() {
    setReconnectMessage("Checking for active table...");
    socket.emit("requestReconnect");
  }

  function sendLobbyChat() {
    const cleanText = lobbyChatText.trim();

    if (!cleanText) return;

    socket.emit("sendLobbyMessage", cleanText);
    setLobbyChatText("");
  }

  function findMatch() {
    if (isMatchmaking) return;

    setIsMatchmaking(true);
    setMatchmakingMessage("Searching for opponent...");

    socket.emit("findMatch", {
      room: activeRoom,
      gameType: queueType,
    });
  }

  function cancelMatchmaking() {
    socket.emit("cancelMatchmaking");
    setIsMatchmaking(false);
    setMatchmakingMessage("Search cancelled.");
  }

  function createTable() {
    setIsMatchmaking(false);
    setMatchmakingMessage("");

    socket.emit("createTable", {
      room: activeRoom,
      redPlayer: currentUser?.screenName || "GuestPlayer",
      gameType: opponentType === "Computer" ? "Casual" : gameType,
      timeControl,
      moveTimer,
      opponentType,
      computerSkill,
      botRating: currentUser?.rating || 1500,
      allowSpectators,
      spectatorChat,
      ratedOnly: opponentType === "Computer" ? false : ratedOnly,
      privateTable,
    });

    setShowCreateTable(false);
  }

  function joinTable(tableId: string) {
    setIsMatchmaking(false);
    setMatchmakingMessage("");
    socket.emit("joinTable", tableId);
  }

  function watchTable(tableId: string) {
    socket.emit("watchTable", tableId);
  }

  function leaveTable() {
    if (currentTable) {
      socket.emit("leaveTable", currentTable.id);
    }

    setCurrentTable(null);
    setPlayerRole(null);
    setSelected(null);
    setAnalysisMoveIndex(null);
    setReconnectMessage("");
    setDragged(null);

    selectionClearedMoveKeyRef.current = "";
  }

  function resignGame() {
    if (!currentTable) return;
    if (playerRole !== "red" && playerRole !== "black") return;
    if (gameState.winner) return;

    socket.emit("resignGame", currentTable.id);
  }

  function resetGame() {
    if (!currentTable) return;

    socket.emit("resetGame", currentTable.id);
  }

  function handleSquareClick(row: number, col: number) {
    if (!currentTable || gameState.winner || playerRole === "spectator" || reviewingMove) return;

    const piece = displayBoard[row]?.[col];

    if (piece && piece.color === gameState.turn && playerRole === gameState.turn) {
      if (
        gameState.forcedPiece &&
        (gameState.forcedPiece.row !== row || gameState.forcedPiece.col !== col)
      ) {
        return;
      }

      setSelected({ row, col });
      return;
    }

    const legalTarget = isLegalTarget(row, col);

    if (!selected || !legalTarget) {
      setSelected(null);
      return;
    }

    socket.emit("makeMove", {
      tableId: currentTable.id,
      from: selected,
      to: {
        row,
        col,
      },
    });
  }

  function handleDraggedMove(row: number, col: number) {
    if (!currentTable || !dragged || gameState.winner || playerRole === "spectator" || reviewingMove) {
      setDragged(null);
      return;
    }

    const draggedLegalMoves = getLegalMoves(dragged.row, dragged.col);
    const legalTarget = draggedLegalMoves.find(
      (move) => move.row === row && move.col === col
    );

    if (!legalTarget) {
      setDragged(null);
      return;
    }

    socket.emit("makeMove", {
      tableId: currentTable.id,
      from: dragged,
      to: {
        row,
        col,
      },
    });

    setDragged(null);
  }

  function getTurnMessage() {
    if (gameState.winner) {
      return `${gameState.winner.toUpperCase()} wins`;
    }

    if (gameState.multiJumpActive || gameState.forcedPiece) {
      return "Multi-jump required";
    }

    const forcedPieces = getForcedCapturePieces();

    if (forcedPieces.length > 0) {
      return "Capture required";
    }

    if (playerRole === "spectator") {
      return `Watching ${gameState.turn.toUpperCase()}'s turn`;
    }

    if (playerRole === gameState.turn) {
      return "Your move";
    }

    return "Opponent's move";
  }


  if (!currentUser) {
    return (
      <main className="min-h-screen bg-[#17100d] text-white p-5 flex items-center justify-center">
        <BoardEffects />

        <div className="w-full max-w-[480px] bg-[#241815] border border-amber-700 rounded-2xl p-6 shadow-2xl">
<div className="flex items-start justify-center select-none mb-2">
            <h1 className="text-5xl font-bold text-amber-400 tracking-wide leading-none">
              CHEXKERS
            </h1>

            <span className="ml-1 mt-[4px] text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700 opacity-80">
              by JT
            </span>
          </div>

          <p className="text-center text-zinc-400 mb-6">
            {authMode === "register"
              ? "Create your account and choose your screen name."
              : "Login to play online."}
          </p>

          <div className="flex bg-[#1b120f] rounded-lg p-1 mb-5 border border-[#3a2721]">
            <button
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
              className={`flex-1 py-2 rounded font-bold ${
                authMode === "login"
                  ? "bg-amber-500 text-black"
                  : "text-zinc-300 hover:bg-[#2b1d18]"
              }`}
            >
              Login
            </button>

            <button
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
              className={`flex-1 py-2 rounded font-bold ${
                authMode === "register"
                  ? "bg-amber-500 text-black"
                  : "text-zinc-300 hover:bg-[#2b1d18]"
              }`}
            >
              Register
            </button>
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="text-sm text-zinc-300">Email</span>
              <input
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@example.com"
                className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-3 outline-none focus:border-amber-500"
              />
            </label>

            {authMode === "register" && (
              <label className="block">
                <span className="text-sm text-zinc-300">Screen Name</span>
                <input
                  value={authScreenName}
                  onChange={(event) => setAuthScreenName(event.target.value)}
                  placeholder="Keyblade300"
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-3 outline-none focus:border-amber-500"
                />

                <div className="text-xs text-zinc-500 mt-1">
                  3-16 characters. Owner account can use JT.
                </div>
              </label>
            )}

            <label className="block">
              <span className="text-sm text-zinc-300">Password</span>
              <input
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                type="password"
                placeholder="Password"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    submitAuth();
                  }
                }}
                className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-3 outline-none focus:border-amber-500"
              />
            </label>

            {authError && (
              <div className="bg-red-950/40 border border-red-700 text-red-300 rounded p-3 text-sm">
                {authError}
              </div>
            )}

            <button
              onClick={submitAuth}
              disabled={authLoading}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed text-black font-bold py-3 rounded-lg"
            >
              {authLoading
                ? "Please wait..."
                : authMode === "register"
                ? "Create Account"
                : "Login"}
            </button>
          </div>

          <div className="mt-5 text-xs text-zinc-500 leading-relaxed">
            Local development account system. Accounts save to your backend
            users.json file. Later, this can move to a real database for
            chexkers.com.
          </div>
        </div>
      </main>
    );
  }

  if (currentTable && isMobileLandscape) {
    const forcedPieces = getForcedCapturePieces();

    return (
      <main className="min-h-screen bg-[#17100d] text-white p-3 overflow-x-hidden">
        <BoardEffects />

        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-start select-none min-w-0">
            <h1 className="text-[30px] font-bold text-amber-400 tracking-wide leading-none">
              CHEXKERS
            </h1>

            <span className="ml-1 mt-[3px] text-[8px] font-bold uppercase tracking-[0.18em] text-amber-700 opacity-80">
              by JT
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setSoundEnabled((value) => !value)}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] px-3 py-2 rounded-lg text-xs font-bold"
            >
              Sound {soundEnabled ? "On" : "Off"}
            </button>

            <button
              onClick={leaveTable}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] px-3 py-2 rounded-lg text-xs font-bold"
            >
              Leave
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(300px,56vh)_1fr] gap-3 items-start">
          <section className="rounded-xl border border-amber-700 bg-[#241815] p-3">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <h2 className="text-lg text-amber-300 font-bold">Live Match</h2>

                <div
                  className={`text-xs mt-0.5 ${
                    gameState.winner
                      ? "text-green-400"
                      : gameState.multiJumpActive || gameState.forcedPiece
                      ? "text-orange-400"
                      : forcedPieces.length > 0
                      ? "text-red-400"
                      : "text-zinc-400"
                  }`}
                >
                  {reviewingMove
                    ? `Reviewing ${analysisSnapshot?.label || "position"}`
                    : gameState.resignedColor
                    ? `${gameState.resignedColor.toUpperCase()} resigned`
                    : gameState.timeoutWinner
                    ? `${gameState.timeoutWinner.toUpperCase()} wins by timeout`
                    : getTurnMessage()}
                </div>
              </div>

              <div className="text-xs text-zinc-400 text-right">
                {currentUser.screenName}
                <div className="text-amber-300 font-bold uppercase">
                  {playerRole}
                </div>
              </div>
            </div>

            <div className="mx-auto w-[min(56vh,calc(100vw-360px))] min-w-[300px] max-w-[520px]">
              <div className="grid grid-cols-8 text-center text-[9px] text-amber-300/80 font-bold tracking-wide mb-1">
                {Array.from({ length: 8 }).map((_, col) => (
                  <div key={`mobile-landscape-file-${col}`}>{"ABCDEFGH"[col]}</div>
                ))}
              </div>

              <div className="w-[min(56vh,calc(100vw-360px))] h-[min(56vh,calc(100vw-360px))] min-w-[300px] min-h-[300px] max-w-[520px] max-h-[520px] grid grid-cols-8 grid-rows-8 border-4 border-amber-900 shadow-2xl">
                {Array.from({ length: 64 }).map((_, index) => {
                  const row = Math.floor(index / 8);
                  const col = index % 8;
                  const dark = (row + col) % 2 === 1;
                  const piece = displayBoard[row]?.[col];
                  const isSelected = selected?.row === row && selected?.col === col;
                  const legalTarget = isLegalTarget(row, col);
                  const forcedPieceGlow = isForcedPiece(row, col);
                  const canSelectPiece =
                    piece &&
                    piece.color === gameState.turn &&
                    playerRole === gameState.turn &&
                    !gameState.winner &&
                    (!gameState.forcedPiece ||
                      (gameState.forcedPiece.row === row &&
                        gameState.forcedPiece.col === col));

                  const captureTarget = Boolean(legalTarget?.capture);
                  const isLastMoveFrom = positionsMatch(gameState.lastMove?.from, {
                    row,
                    col,
                  });
                  const isLastMoveTo = positionsMatch(gameState.lastMove?.to, {
                    row,
                    col,
                  });

                  return (
                    <button
                      key={index}
                      onClick={() => handleSquareClick(row, col)}
                      className={`relative flex items-center justify-center transition ${
                        dark ? "bg-[#5b2f1f]" : "bg-[#c08a5a]"
                      } ${isSelected ? "ring-4 ring-amber-300 z-20" : ""} ${
                        legalTarget
                          ? captureTarget
                            ? "ring-4 ring-red-400 z-10"
                            : "ring-4 ring-green-400 z-10"
                          : ""
                      } ${
                        forcedPieceGlow && !isSelected
                          ? "ring-4 ring-orange-400 z-10"
                          : ""
                      } ${canSelectPiece ? "cursor-pointer" : ""}`}
                    >
                      {isLastMoveFrom && (
                        <div className="absolute inset-1 border-2 border-blue-300/45 rounded-sm chex-move-trail" />
                      )}

                      {isLastMoveTo && (
                        <div className="absolute inset-1 border-2 border-blue-200/60 rounded-sm chex-move-trail" />
                      )}

                      {legalTarget && (
                        <div
                          className={`absolute rounded-full ${
                            captureTarget
                              ? "h-5 w-5 bg-red-500/75 animate-pulse"
                              : "h-3.5 w-3.5 bg-green-400/75"
                          }`}
                        />
                      )}

                      {piece && (
                        <div
                          className={`h-[72%] w-[72%] rounded-full border-[3px] shadow-lg flex items-center justify-center ${
                            piece.color === "red"
                              ? "bg-red-600 border-red-300"
                              : "bg-zinc-900 border-zinc-500"
                          } ${
                            forcedPieceGlow
                              ? "shadow-[0_0_18px_rgba(251,146,60,0.95)]"
                              : canSelectPiece
                              ? "shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                              : ""
                          }`}
                        >
                          <div className="h-[70%] w-[70%] rounded-full border-2 border-black/30 flex items-center justify-center">
                            {piece.king && (
                              <span className="text-amber-300 text-base font-bold">
                                K
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <aside className="rounded-xl border border-amber-700 bg-[#241815] p-3 max-h-[calc(100dvh-92px)] overflow-y-auto">
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div
                className={`rounded-lg border p-2 text-center ${
                  gameState.turn === "red"
                    ? "border-red-400 bg-red-950/40"
                    : "border-zinc-700 bg-zinc-900/40"
                }`}
              >
                <div className="text-[10px] uppercase text-zinc-400">Red</div>
                <div
                  className={`text-base font-bold ${
                    isLowTime(gameState.redTimeLeft)
                      ? "text-red-400 animate-pulse"
                      : "text-white"
                  }`}
                >
                  {formatClock(gameState.redTimeLeft)}
                </div>
              </div>

              <div
                className={`rounded-lg border p-2 text-center ${
                  isLowTime(gameState.moveTimeLeft)
                    ? "border-orange-400 bg-orange-950/40"
                    : "border-amber-700 bg-[#2a1c17]"
                }`}
              >
                <div className="text-[10px] uppercase text-zinc-400">Move</div>
                <div
                  className={`text-base font-bold ${
                    isLowTime(gameState.moveTimeLeft)
                      ? "text-orange-400 animate-pulse"
                      : "text-amber-300"
                  }`}
                >
                  {formatClock(gameState.moveTimeLeft)}
                </div>
              </div>

              <div
                className={`rounded-lg border p-2 text-center ${
                  gameState.turn === "black"
                    ? "border-zinc-300 bg-zinc-800/60"
                    : "border-zinc-700 bg-zinc-900/40"
                }`}
              >
                <div className="text-[10px] uppercase text-zinc-400">Black</div>
                <div
                  className={`text-base font-bold ${
                    isLowTime(gameState.blackTimeLeft)
                      ? "text-red-400 animate-pulse"
                      : "text-white"
                  }`}
                >
                  {formatClock(gameState.blackTimeLeft)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={resetGame}
                disabled={playerRole !== "red"}
                className="bg-[#5a3a2d] hover:bg-[#6c4737] disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-lg text-sm font-bold"
              >
                {gameState.winner ? "Rematch" : "Reset"}
              </button>

              <button
                onClick={resignGame}
                disabled={
                  (playerRole !== "red" && playerRole !== "black") ||
                  gameState.winner !== null ||
                  reviewingMove
                }
                className="bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-lg text-sm font-bold"
              >
                Resign
              </button>
            </div>

            <div className="rounded-lg border border-[#3a2721] bg-[#1b120f] p-3 mb-3">
              <h3 className="text-amber-300 font-bold mb-2">Table Info</h3>

              <div className="grid grid-cols-2 gap-y-1 text-xs">
                <span className="text-zinc-400">Mode</span>
                <span className="text-right">{currentTable.gameType}</span>

                <span className="text-zinc-400">Red</span>
                <span className="text-right">{currentTable.redPlayer}</span>

                <span className="text-zinc-400">Black</span>
                <span className="text-right">{currentTable.blackPlayer}</span>

                <span className="text-zinc-400">Captured</span>
                <span className="text-right">
                  R {gameState.redCaptured} â€¢ B {gameState.blackCaptured}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-[#3a2721] bg-[#1b120f] p-3 mb-3">
              <h3 className="text-amber-300 font-bold mb-2">Move History</h3>

              <div className="max-h-28 overflow-y-auto text-xs space-y-1">
                {(gameState.moveHistory || []).length === 0 ? (
                  <div className="text-zinc-500">No moves yet.</div>
                ) : (
                  (gameState.moveHistory || []).map((move) => (
                    <div
                      key={move.number}
                      className="grid grid-cols-[34px_1fr] gap-2"
                    >
                      <span className="text-zinc-500">#{move.number}</span>
                      <span
                        className={
                          move.color === "red"
                            ? "text-red-300"
                            : "text-zinc-200"
                        }
                      >
                        {move.notation}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[#3a2721] bg-[#1b120f] p-3">
              <h3 className="text-amber-300 font-bold mb-2">Table Chat</h3>

              <div className="h-20 overflow-y-auto text-xs space-y-1 mb-2">
                <div>System: Table opened.</div>
                <div>System: {currentTable.redPlayer} is seated as Red.</div>
                {currentTable.blackPlayer !== "Open Seat" && (
                  <div>System: {currentTable.blackPlayer} is seated as Black.</div>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  placeholder="Message..."
                  className="flex-1 min-w-0 bg-[#2b1d18] border border-[#5a4034] rounded px-2 py-2 text-sm outline-none"
                />

                <button className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 rounded">
                  Send
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  if (currentTable && isMobileLayout) {
    const forcedPieces = getForcedCapturePieces();

    return (
      <main className="min-h-screen bg-[#17100d] text-white p-3 overflow-x-hidden">
        <BoardEffects />

        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="flex items-start select-none">
              <h1 className="text-[34px] font-bold text-amber-400 tracking-wide leading-none">
                CHEXKERS
              </h1>

              <span className="ml-1 mt-[3px] text-[8px] font-bold uppercase tracking-[0.18em] text-amber-700 opacity-80">
                by JT
              </span>
            </div>

            <div className="text-xs text-zinc-400 mt-1">
              {currentUser.screenName} â€¢ {playerRole?.toUpperCase()}
            </div>
          </div>

          <button
            onClick={leaveTable}
            className="bg-[#5a3a2d] hover:bg-[#6c4737] px-3 py-2 rounded-lg text-sm font-bold shrink-0"
          >
            Leave
          </button>
        </div>

        <section className="rounded-xl border border-amber-700 bg-[#241815] p-3 mb-3">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-xl text-amber-300 font-bold">Live Match</h2>

              <div
                className={`text-sm mt-1 ${
                  gameState.winner
                    ? "text-green-400"
                    : gameState.multiJumpActive || gameState.forcedPiece
                    ? "text-orange-400"
                    : forcedPieces.length > 0
                    ? "text-red-400"
                    : "text-zinc-400"
                }`}
              >
                {reviewingMove
                  ? `Reviewing ${analysisSnapshot?.label || "position"}`
                  : gameState.resignedColor
                  ? `${gameState.resignedColor.toUpperCase()} resigned`
                  : gameState.timeoutWinner
                  ? `${gameState.timeoutWinner.toUpperCase()} wins by timeout`
                  : getTurnMessage()}
              </div>
            </div>

            <button
              onClick={() => setSoundEnabled((value) => !value)}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] px-3 py-2 rounded-lg text-xs"
            >
              Sound {soundEnabled ? "On" : "Off"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div
              className={`rounded-lg border p-2 text-center ${
                gameState.turn === "red"
                  ? "border-red-400 bg-red-950/40"
                  : "border-zinc-700 bg-zinc-900/40"
              }`}
            >
              <div className="text-[10px] uppercase text-zinc-400">Red</div>
              <div
                className={`text-lg font-bold ${
                  isLowTime(gameState.redTimeLeft)
                    ? "text-red-400 animate-pulse"
                    : "text-white"
                }`}
              >
                {formatClock(gameState.redTimeLeft)}
              </div>
            </div>

            <div
              className={`rounded-lg border p-2 text-center ${
                isLowTime(gameState.moveTimeLeft)
                  ? "border-orange-400 bg-orange-950/40"
                  : "border-amber-700 bg-[#2a1c17]"
              }`}
            >
              <div className="text-[10px] uppercase text-zinc-400">Move</div>
              <div
                className={`text-lg font-bold ${
                  isLowTime(gameState.moveTimeLeft)
                    ? "text-orange-400 animate-pulse"
                    : "text-amber-300"
                }`}
              >
                {formatClock(gameState.moveTimeLeft)}
              </div>
            </div>

            <div
              className={`rounded-lg border p-2 text-center ${
                gameState.turn === "black"
                  ? "border-zinc-300 bg-zinc-800/60"
                  : "border-zinc-700 bg-zinc-900/40"
              }`}
            >
              <div className="text-[10px] uppercase text-zinc-400">Black</div>
              <div
                className={`text-lg font-bold ${
                  isLowTime(gameState.blackTimeLeft)
                    ? "text-red-400 animate-pulse"
                    : "text-white"
                }`}
              >
                {formatClock(gameState.blackTimeLeft)}
              </div>
            </div>
          </div>

          <div className="mx-auto w-[calc(100vw-32px)] max-w-[520px]">
            <div className="grid grid-cols-8 text-center text-[10px] text-amber-300/80 font-bold tracking-wide mb-1">
              {Array.from({ length: 8 }).map((_, col) => (
                <div key={`mobile-file-${col}`}>{"ABCDEFGH"[col]}</div>
              ))}
            </div>

            <div className="w-[calc(100vw-32px)] h-[calc(100vw-32px)] max-w-[520px] max-h-[520px] grid grid-cols-8 grid-rows-8 border-4 border-amber-900 shadow-2xl">
              {Array.from({ length: 64 }).map((_, index) => {
                const row = Math.floor(index / 8);
                const col = index % 8;
                const dark = (row + col) % 2 === 1;
                const piece = displayBoard[row]?.[col];
                const isSelected = selected?.row === row && selected?.col === col;
                const legalTarget = isLegalTarget(row, col);
                const forcedPieceGlow = isForcedPiece(row, col);
                const canSelectPiece =
                  piece &&
                  piece.color === gameState.turn &&
                  playerRole === gameState.turn &&
                  !gameState.winner &&
                  (!gameState.forcedPiece ||
                    (gameState.forcedPiece.row === row &&
                      gameState.forcedPiece.col === col));

                const captureTarget = Boolean(legalTarget?.capture);
                const isLastMoveFrom = positionsMatch(gameState.lastMove?.from, {
                  row,
                  col,
                });
                const isLastMoveTo = positionsMatch(gameState.lastMove?.to, {
                  row,
                  col,
                });

                return (
                  <button
                    key={index}
                    onClick={() => handleSquareClick(row, col)}
                    className={`relative flex items-center justify-center transition ${
                      dark ? "bg-[#5b2f1f]" : "bg-[#c08a5a]"
                    } ${isSelected ? "ring-4 ring-amber-300 z-20" : ""} ${
                      legalTarget
                        ? captureTarget
                          ? "ring-4 ring-red-400 z-10"
                          : "ring-4 ring-green-400 z-10"
                        : ""
                    } ${
                      forcedPieceGlow && !isSelected
                        ? "ring-4 ring-orange-400 z-10"
                        : ""
                    } ${canSelectPiece ? "cursor-pointer" : ""}`}
                  >
                    {isLastMoveFrom && (
                      <div className="absolute inset-1 border-2 border-blue-300/45 rounded-sm chex-move-trail" />
                    )}

                    {isLastMoveTo && (
                      <div className="absolute inset-1 border-2 border-blue-200/60 rounded-sm chex-move-trail" />
                    )}

                    {legalTarget && (
                      <div
                        className={`absolute rounded-full ${
                          captureTarget
                            ? "h-6 w-6 bg-red-500/75 animate-pulse"
                            : "h-4 w-4 bg-green-400/75"
                        }`}
                      />
                    )}

                    {piece && (
                      <div
                        className={`h-[72%] w-[72%] rounded-full border-[3px] shadow-lg flex items-center justify-center ${
                          piece.color === "red"
                            ? "bg-red-600 border-red-300"
                            : "bg-zinc-900 border-zinc-500"
                        } ${
                          forcedPieceGlow
                            ? "shadow-[0_0_18px_rgba(251,146,60,0.95)]"
                            : canSelectPiece
                            ? "shadow-[0_0_12px_rgba(251,191,36,0.65)]"
                            : ""
                        }`}
                      >
                        <div className="h-[70%] w-[70%] rounded-full border-2 border-black/30 flex items-center justify-center">
                          {piece.king && (
                            <span className="text-amber-300 text-base font-bold">
                              K
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-3">
            <button
              onClick={resetGame}
              disabled={playerRole !== "red"}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-lg font-bold"
            >
              {gameState.winner ? "Rematch" : "Reset"}
            </button>

            <button
              onClick={resignGame}
              disabled={
                (playerRole !== "red" && playerRole !== "black") ||
                gameState.winner !== null ||
                reviewingMove
              }
              className="bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed py-2 rounded-lg font-bold"
            >
              Resign
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-amber-700 bg-[#241815] p-3 mb-3">
          <h2 className="text-xl text-amber-300 font-bold mb-3">Move History</h2>

          <div className="rounded-lg border border-[#3a2721] bg-[#1b120f] p-3 max-h-44 overflow-y-auto text-sm space-y-1">
            {(gameState.moveHistory || []).length === 0 ? (
              <div className="text-zinc-500">No moves yet.</div>
            ) : (
              (gameState.moveHistory || []).map((move) => (
                <div
                  key={move.number}
                  className="grid grid-cols-[42px_1fr] gap-2 text-xs"
                >
                  <span className="text-zinc-500">#{move.number}</span>
                  <span
                    className={
                      move.color === "red" ? "text-red-300" : "text-zinc-200"
                    }
                  >
                    {move.notation}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-xl border border-amber-700 bg-[#241815] p-3 mb-3">
          <h2 className="text-xl text-amber-300 font-bold mb-3">Table Info</h2>

          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-zinc-400">Mode</span>
            <span className="text-right">{currentTable.gameType}</span>

            <span className="text-zinc-400">Red</span>
            <span className="text-right">{currentTable.redPlayer}</span>

            <span className="text-zinc-400">Black</span>
            <span className="text-right">{currentTable.blackPlayer}</span>

            <span className="text-zinc-400">Captured</span>
            <span className="text-right">
              R {gameState.redCaptured} â€¢ B {gameState.blackCaptured}
            </span>

            <span className="text-zinc-400">Status</span>
            <span className="text-right">{getTurnMessage()}</span>
          </div>
        </section>

        <section className="rounded-xl border border-amber-700 bg-[#241815] p-3">
          <h2 className="text-xl text-amber-300 font-bold mb-3">Table Chat</h2>

          <div className="bg-[#1b120f] rounded p-3 h-36 text-sm space-y-2 overflow-y-auto">
            <div>System: Table opened.</div>
            <div>System: {currentTable.redPlayer} is seated as Red.</div>
            {currentTable.blackPlayer !== "Open Seat" && (
              <div>System: {currentTable.blackPlayer} is seated as Black.</div>
            )}
            {forcedPieces.length > 0 && !gameState.winner && (
              <div className="text-red-300">System: Capture required.</div>
            )}
            {(gameState.multiJumpActive || gameState.forcedPiece) &&
              !gameState.winner && (
                <div className="text-orange-300">
                  System: Multi-jump must continue.
                </div>
              )}
            {gameState.winner && (
              <div className="text-amber-300">
                System: {gameState.winner.toUpperCase()} wins.
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              placeholder="Table message..."
              className="flex-1 bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-3 text-sm outline-none"
            />

            <button className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 rounded">
              Send
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (currentTable) {
    const flipBoard = playerRole === "black";
    const forcedPieces = getForcedCapturePieces();

    return (
      <main className="h-screen overflow-hidden bg-[#17100d] text-white p-5">
        <BoardEffects />
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-start select-none">
            <h1 className="text-5xl font-bold text-amber-400 tracking-wide leading-none">
              CHEXKERS
            </h1>

            <span className="ml-1 mt-[4px] text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700 opacity-80">
              by JT
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="bg-[#241815] border border-amber-700 rounded-lg px-3 py-2 text-sm">
              <span className="text-zinc-400">Player:</span>{" "}
              <span className="text-amber-300 font-bold">
                {currentUser.screenName}
              </span>
            </div>

            <button
              onClick={logout}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] px-4 py-2 rounded"
            >
              Logout
            </button>

            <button
              onClick={() => setSoundEnabled((value) => !value)}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] px-4 py-2 rounded"
            >
              Sound: {soundEnabled ? "On" : "Off"}
            </button>

            <button
              onClick={resetGame}
              disabled={playerRole !== "red"}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] disabled:opacity-40 disabled:cursor-not-allowed px-4 py-2 rounded"
            >
              {gameState.winner ? "Rematch" : "Reset"}
            </button>

            <button
              onClick={leaveTable}
              className="bg-[#5a3a2d] hover:bg-[#6c4737] px-4 py-2 rounded"
            >
              Leave Table
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[270px_1fr_340px] gap-4 h-[calc(100vh-105px)]">
          <aside className="bg-[#241815] border border-amber-700 rounded-xl p-4 overflow-hidden flex flex-col">
          <h2 className="text-2xl font-bold text-amber-400 mb-2">
            Match Log
          </h2>

          <div className="text-xs text-zinc-400 mb-4 leading-relaxed">
            Move history, captures, kings, resigns, and timeouts.
          </div>

          <div className="grid grid-cols-1 gap-3 mb-4 shrink-0">
            <CapturedPieceTray
              label="Red Lost"
              color="red"
              count={gameState.redCaptured}
            />

            <CapturedPieceTray
              label="Black Lost"
              color="black"
              count={gameState.blackCaptured}
            />
          </div>

          <div className="rounded-lg border border-[#3a2721] bg-[#1b120f] p-3 mb-4 text-sm shrink-0">
            <div className="flex justify-between">
              <span className="text-zinc-400">Material Lead</span>
              <span
                className={
                  gameState.redCaptured === gameState.blackCaptured
                    ? "text-zinc-300"
                    : gameState.blackCaptured > gameState.redCaptured
                    ? "text-red-300"
                    : "text-zinc-200"
                }
              >
                {gameState.redCaptured === gameState.blackCaptured
                  ? "Even"
                  : gameState.blackCaptured > gameState.redCaptured
                  ? `Red +${gameState.blackCaptured - gameState.redCaptured}`
                  : `Black +${gameState.redCaptured - gameState.blackCaptured}`}
              </span>
            </div>
          </div>

          <div className="flex flex-col min-h-0 flex-1">
              <h3 className="text-amber-300 mb-2 shrink-0">Move History</h3>

              <div className="bg-[#1b120f] rounded p-3 flex-1 min-h-0 text-sm overflow-y-auto space-y-1 border border-[#3a2721]">
                {(gameState.moveHistory || []).length === 0 ? (
                  <div className="text-zinc-500">No moves yet.</div>
                ) : (
                  (gameState.moveHistory || []).map((move) => (
                    <div
                      key={move.number}
                      className="grid grid-cols-[34px_1fr] gap-2 text-xs"
                    >
                      <span className="text-zinc-500">#{move.number}</span>
                      <span
                        className={
                          move.color === "red"
                            ? "text-red-300"
                            : "text-zinc-200"
                        }
                      >
                        {move.notation}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>



          <div className="mt-4 rounded-lg border border-[#3a2721] bg-[#1b120f] p-3 text-xs text-zinc-500 leading-relaxed shrink-0">
            <div>x = capture</div>
            <div>= KING = promotion</div>
          </div>
        </aside>

        <section className="bg-[#241815] border border-amber-700 rounded-xl p-4 overflow-hidden flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-2xl text-amber-300">Live Match</h2>
                <div
                  className={`text-sm mt-1 ${
                    gameState.winner
                      ? "text-green-400"
                      : gameState.multiJumpActive || gameState.forcedPiece
                      ? "text-orange-400"
                      : forcedPieces.length > 0
                      ? "text-red-400"
                      : "text-zinc-400"
                  }`}
                >
                  {reviewingMove
                    ? `Reviewing ${analysisSnapshot?.label || "position"}`
                    : gameState.resignedColor
                    ? `${gameState.resignedColor.toUpperCase()} resigned`
                    : gameState.timeoutWinner
                    ? `${gameState.timeoutWinner.toUpperCase()} wins by timeout`
                    : getTurnMessage()}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`rounded-lg px-4 py-2 border text-center min-w-[105px] ${
                    gameState.turn === "red"
                      ? "border-red-400 bg-red-950/40"
                      : "border-zinc-700 bg-zinc-900/40"
                  }`}
                >
                  <div className="text-xs text-zinc-400 uppercase">Red</div>
                  <div
                    className={`text-2xl font-bold ${
                      isLowTime(gameState.redTimeLeft)
                        ? "text-red-400 animate-pulse"
                        : "text-white"
                    }`}
                  >
                    {formatClock(gameState.redTimeLeft)}
                  </div>
                </div>

                <div
                  className={`rounded-lg px-4 py-2 border text-center min-w-[105px] ${
                    isLowTime(gameState.moveTimeLeft)
                      ? "border-orange-400 bg-orange-950/40"
                      : "border-amber-700 bg-[#2a1c17]"
                  }`}
                >
                  <div className="text-xs text-zinc-400 uppercase">Move</div>
                  <div
                    className={`text-2xl font-bold ${
                      isLowTime(gameState.moveTimeLeft)
                        ? "text-orange-400 animate-pulse"
                        : "text-amber-300"
                    }`}
                  >
                    {formatClock(gameState.moveTimeLeft)}
                  </div>
                </div>

                <div
                  className={`rounded-lg px-4 py-2 border text-center min-w-[105px] ${
                    gameState.turn === "black"
                      ? "border-zinc-300 bg-zinc-800/60"
                      : "border-zinc-700 bg-zinc-900/40"
                  }`}
                >
                  <div className="text-xs text-zinc-400 uppercase">Black</div>
                  <div
                    className={`text-2xl font-bold ${
                      isLowTime(gameState.blackTimeLeft)
                        ? "text-red-400 animate-pulse"
                        : "text-white"
                    }`}
                  >
                    {formatClock(gameState.blackTimeLeft)}
                  </div>
                </div>

                <div className="text-sm text-zinc-400 text-right ml-2">
                  Turn:{" "}
                  <span
                    className={
                      gameState.turn === "red"
                        ? "text-red-400 font-bold uppercase"
                        : "text-zinc-300 font-bold uppercase"
                    }
                  >
                    {gameState.turn}
                  </span>
                  <div>
                    Role:{" "}
                    <span className="text-amber-300 font-bold uppercase">
                      {playerRole}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex items-center justify-center">
              <div className="grid grid-cols-[24px_640px_24px] grid-rows-[22px_640px_22px] items-center justify-center">
                <div />

                <div className="grid grid-cols-8 text-center text-xs text-amber-300/80 font-bold tracking-wide">
                  {Array.from({ length: 8 }).map((_, displayCol) => {
                    const realCol = flipBoard ? 7 - displayCol : displayCol;
                    return (
                      <div key={`top-file-${displayCol}`}>
                        {"ABCDEFGH"[realCol]}
                      </div>
                    );
                  })}
                </div>

                <div />

                <div className="grid grid-rows-8 h-[640px] text-center text-xs text-amber-300/80 font-bold">
                  {Array.from({ length: 8 }).map((_, displayRow) => {
                    const realRow = flipBoard ? 7 - displayRow : displayRow;
                    return (
                      <div
                        key={`left-rank-${displayRow}`}
                        className="flex items-center justify-center"
                      >
                        {8 - realRow}
                      </div>
                    );
                  })}
                </div>

                <div className="w-[640px] h-[640px] grid grid-cols-8 grid-rows-8 border-4 border-amber-900 shadow-2xl">
              {Array.from({ length: 64 }).map((_, displayIndex) => {
                const displayRow = Math.floor(displayIndex / 8);
                const displayCol = displayIndex % 8;

                const row = flipBoard ? 7 - displayRow : displayRow;
                const col = flipBoard ? 7 - displayCol : displayCol;

                const dark = (row + col) % 2 === 1;
                const piece = displayBoard[row]?.[col];
                const isSelected = selected?.row === row && selected?.col === col;
                const legalTarget = isLegalTarget(row, col);
                const forcedPieceGlow = isForcedPiece(row, col);
                const canSelectPiece =
                  piece &&
                  piece.color === gameState.turn &&
                  playerRole === gameState.turn &&
                  !gameState.winner &&
                  (!gameState.forcedPiece ||
                    (gameState.forcedPiece.row === row &&
                      gameState.forcedPiece.col === col));

                const captureTarget = Boolean(legalTarget?.capture);
                const isLastMoveFrom = positionsMatch(gameState.lastMove?.from, {
                  row,
                  col,
                });
                const isLastMoveTo = positionsMatch(gameState.lastMove?.to, {
                  row,
                  col,
                });
                const isLastCaptured = positionsMatch(gameState.lastMove?.capture, {
                  row,
                  col,
                });
                const lastMovePromoted =
                  Boolean(gameState.lastMove?.promoted) && isLastMoveTo;
                const lastMoveWasCapture =
                  Boolean(gameState.lastMove?.capture) && isLastMoveTo;

                return (
                  <button
                    key={displayIndex}
                    draggable={Boolean(canSelectPiece)}
                    onDragStart={(event) => {
                      if (!canSelectPiece) {
                        event.preventDefault();
                        return;
                      }

                      setSelected({ row, col });
                      setDragged({ row, col });
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(event) => {
                      if (dragged) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      handleDraggedMove(row, col);
                    }}
                    onDragEnd={() => setDragged(null)}
                    onClick={() => handleSquareClick(row, col)}
                    className={`relative flex items-center justify-center transition ${
                      dark ? "bg-[#5b2f1f]" : "bg-[#c08a5a]"
                    } ${isSelected ? "ring-4 ring-amber-300 z-20" : ""} ${
                      legalTarget
                        ? captureTarget
                          ? "ring-4 ring-red-400 z-10"
                          : "ring-4 ring-green-400 z-10"
                        : ""
                    } ${
                      forcedPieceGlow && !isSelected
                        ? "ring-4 ring-orange-400 z-10"
                        : ""
                    } ${canSelectPiece ? "cursor-pointer hover:brightness-125" : ""}`}
                  >
                    {isLastMoveFrom && (
                      <div className="absolute inset-2 border-2 border-blue-300/45 rounded-sm chex-move-trail" />
                    )}

                    {isLastMoveTo && (
                      <div className="absolute inset-3 border-2 border-blue-200/60 rounded-sm chex-move-trail" />
                    )}

                    {isLastMoveTo && (
                      <div className="absolute inset-0 bg-blue-300/15 animate-pulse" />
                    )}

                    {isLastCaptured && (
                      <div className="absolute inset-0 bg-red-600/20 animate-pulse" />
                    )}

                    {legalTarget && (
                      <div
                        className={`absolute rounded-full ${
                          captureTarget
                            ? "h-8 w-8 bg-red-500/75 animate-pulse"
                            : "h-5 w-5 bg-green-400/75"
                        }`}
                      />
                    )}

                    {forcedPieceGlow && !isSelected && (
                      <div className="absolute inset-1 border-2 border-orange-300/70 rounded-sm animate-pulse" />
                    )}

                    {piece && (
                      <div
                        className={`h-14 w-14 rounded-full border-4 shadow-lg flex items-center justify-center transition ${
                          piece.color === "red"
                            ? "bg-red-600 border-red-300"
                            : "bg-zinc-900 border-zinc-500"
                        } ${
                          forcedPieceGlow
                            ? "shadow-[0_0_22px_rgba(251,146,60,0.95)]"
                            : canSelectPiece
                            ? "shadow-[0_0_14px_rgba(251,191,36,0.65)]"
                            : ""
                        }`}
                      >
                        <div className="h-10 w-10 rounded-full border-2 border-black/30 flex items-center justify-center">
                          {piece.king && (
                            <span className="text-amber-300 text-xl font-bold">
                              K
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {captureTarget && legalTarget?.capture && (
                      <div className="absolute top-1 right-1 text-[10px] bg-red-600 text-white px-1 rounded">
                        JUMP
                      </div>
                    )}
                  </button>
                );
              })}
                </div>

                <div className="grid grid-rows-8 h-[640px] text-center text-xs text-amber-300/80 font-bold">
                  {Array.from({ length: 8 }).map((_, displayRow) => {
                    const realRow = flipBoard ? 7 - displayRow : displayRow;
                    return (
                      <div
                        key={`right-rank-${displayRow}`}
                        className="flex items-center justify-center"
                      >
                        {8 - realRow}
                      </div>
                    );
                  })}
                </div>

                <div />

                <div className="grid grid-cols-8 text-center text-xs text-amber-300/80 font-bold tracking-wide">
                  {Array.from({ length: 8 }).map((_, displayCol) => {
                    const realCol = flipBoard ? 7 - displayCol : displayCol;
                    return (
                      <div key={`bottom-file-${displayCol}`}>
                        {"ABCDEFGH"[realCol]}
                      </div>
                    );
                  })}
                </div>

                <div />
              </div>
            </div>
          </section>

          <aside className="bg-[#241815] border border-amber-700 rounded-xl p-4 overflow-hidden flex flex-col">
            <h2 className="text-xl text-amber-300 mb-3 shrink-0">Table Info</h2>

            <div className="space-y-2 text-sm shrink-0">
              <div className="flex justify-between">
                <span>Mode</span>
                <span>{currentTable.gameType}</span>
              </div>

              <div className="flex justify-between">
                <span>Red Player</span>
                <span>{currentTable.redPlayer}</span>
              </div>

              <div className="flex justify-between">
                <span>Black Player</span>
                <span>{currentTable.blackPlayer}</span>
              </div>

              {currentTable.opponentType === "Computer" && (
                <div className="flex justify-between">
                  <span>Bot Skill</span>
                  <span className="text-amber-300">
                    {currentTable.computerSkill || "Around My Rating"}
                  </span>
                </div>
              )}

              <div className="flex justify-between">
                <span>Red Captured</span>
                <span>{gameState.redCaptured}</span>
              </div>

              <div className="flex justify-between">
                <span>Black Captured</span>
                <span>{gameState.blackCaptured}</span>
              </div>

              <div className="flex justify-between">
                <span>Time</span>
                <span>{currentTable.timeControl}</span>
              </div>

              <div className="flex justify-between">
                <span>Move Timer</span>
                <span>{currentTable.moveTimer}</span>
              </div>

              <div className="flex justify-between">
                <span>Red Clock</span>
                <span
                  className={
                    isLowTime(gameState.redTimeLeft)
                      ? "text-red-400 animate-pulse font-bold"
                      : "text-zinc-300"
                  }
                >
                  {formatClock(gameState.redTimeLeft)}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Black Clock</span>
                <span
                  className={
                    isLowTime(gameState.blackTimeLeft)
                      ? "text-red-400 animate-pulse font-bold"
                      : "text-zinc-300"
                  }
                >
                  {formatClock(gameState.blackTimeLeft)}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Move Clock</span>
                <span
                  className={
                    isLowTime(gameState.moveTimeLeft)
                      ? "text-orange-400 animate-pulse font-bold"
                      : "text-amber-300"
                  }
                >
                  {formatClock(gameState.moveTimeLeft)}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Status</span>
                <span className={gameState.winner ? "text-amber-300" : "text-green-400"}>
                  {gameState.resignedColor
                    ? "Resigned"
                    : gameState.winner
                    ? "Finished"
                    : currentTable.status}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Move State</span>
                <span
                  className={
                    gameState.multiJumpActive || gameState.forcedPiece
                      ? "text-orange-400"
                      : forcedPieces.length > 0
                      ? "text-red-400"
                      : "text-zinc-300"
                  }
                >
                  {gameState.multiJumpActive || gameState.forcedPiece
                    ? "Multi-jump"
                    : forcedPieces.length > 0
                    ? "Capture required"
                    : "Normal"}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Last Move</span>
                <span className="text-blue-300">
                  {gameState.lastMove
                    ? `${gameState.lastMove.from.row},${gameState.lastMove.from.col} to ${gameState.lastMove.to.row},${gameState.lastMove.to.col}`
                    : "-"}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Move Count</span>
                <span className="text-zinc-300">
                  {(gameState.moveHistory || []).length}
                </span>
              </div>

              <div className="flex justify-between">
                <span>Effects</span>
                <span className="text-amber-300">
                  Animation + Sound
                </span>
              </div>
            </div>

            {gameState.ratingResult && (
              <div className="mt-4 rounded-lg border border-red-700 bg-red-950/30 p-3 text-sm shrink-0">
                <h3 className="text-red-300 font-bold mb-2">
                  Rating Change
                </h3>

                <div className="flex justify-between">
                  <span>{gameState.ratingResult.winnerScreenName}</span>
                  <span className="text-green-400 font-bold">
                    +{gameState.ratingResult.winnerDelta}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span>{gameState.ratingResult.loserScreenName}</span>
                  <span className="text-red-400 font-bold">
                    {gameState.ratingResult.loserDelta}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-4 min-h-0 flex flex-col flex-1">
              <h3 className="text-amber-300 mb-2 shrink-0">Table Chat</h3>

              <div className="bg-[#1b120f] rounded p-3 flex-1 min-h-[100px] text-sm space-y-2 overflow-y-auto">
                <div>System: Table opened.</div>
                <div>System: {currentTable.redPlayer} is seated as Red.</div>
                <div>System: Sounds and last-move highlights enabled.</div>
                {currentTable.blackPlayer !== "Open Seat" && (
                  <div>
                    System: {currentTable.blackPlayer} is seated as Black.
                  </div>
                )}
                {forcedPieces.length > 0 && !gameState.winner && (
                  <div className="text-red-300">
                    System: Capture required.
                  </div>
                )}
                {(gameState.multiJumpActive || gameState.forcedPiece) &&
                  !gameState.winner && (
                    <div className="text-orange-300">
                      System: Multi-jump required with the highlighted piece.
                    </div>
                  )}
                {gameState.resignedColor && (
                  <div className="text-red-300">
                    System: {gameState.resignedColor} resigned.
                  </div>
                )}
                {gameState.timeoutWinner && (
                  <div className="text-red-300">
                    System: {gameState.timeoutWinner} wins by timeout.
                  </div>
                )}
                {gameState.winner &&
                  !gameState.timeoutWinner &&
                  !gameState.resignedColor && (
                  <div className="text-amber-300">
                    System: {gameState.winner} wins!
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <input
                  placeholder="Type message..."
                  className="flex-1 bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                />

                <button className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 rounded">
                  Send
                </button>
              </div>
            </div>

            <button
              onClick={resignGame}
              disabled={
                gameState.winner !== null ||
                (playerRole !== "red" && playerRole !== "black")
              }
              className="mt-6 w-full bg-red-700 hover:bg-red-600 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed font-bold py-2 rounded"
            >
              Resign
            </button>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#17100d] text-white p-5">
      <BoardEffects />
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-start select-none">
            <div className="flex items-start select-none">
  <h1 className="text-5xl font-bold text-amber-400 tracking-wide leading-none">
    CHEXKERS
  </h1>

  <span className="ml-1 mt-[4px] text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700 opacity-80">
    by JT
  </span>
</div>
          </div>

        <div className="flex items-center gap-4">
          <div className="bg-[#241815] border border-amber-700 rounded-lg px-3 py-2 text-sm flex items-center gap-3">
            <div>
              <span className="text-zinc-400">Player:</span>{" "}
              <span className="text-amber-300 font-bold">
                {currentUser.screenName}
              </span>
            </div>

            {currentUser.screenName === "JT" && (
              <div className="h-6 w-6 rounded-full bg-gradient-to-br from-amber-400 to-orange-600 border border-amber-200 flex items-center justify-center text-[8px] font-black text-black shadow-[0_0_8px_rgba(251,191,36,0.45)]">
                DEV
              </div>
            )}
          </div>

          <button
            onClick={logout}
            className="bg-[#5a3a2d] hover:bg-[#6c4737] px-4 py-2 rounded"
          >
            Logout
          </button>

          <div className="text-sm text-zinc-400">
            Server:{" "}
            <span
              className={
                serverStatus === "Connected"
                  ? "text-green-400 font-bold"
                  : "text-red-400 font-bold"
              }
            >
              {serverStatus}
            </span>
          </div>

          <div className="flex items-center gap-2 bg-[#241815] border border-amber-700 rounded-lg px-3 py-2">
            <span className="text-zinc-400 text-sm">Queue:</span>
            <button
              onClick={() => setQueueType("Casual")}
              className={`px-3 py-1 rounded text-sm font-bold ${
                queueType === "Casual"
                  ? "bg-amber-500 text-black"
                  : "bg-[#2b1d18] text-zinc-300"
              }`}
            >
              Casual
            </button>
            <button
              onClick={() => setQueueType("Ranked")}
              className={`px-3 py-1 rounded text-sm font-bold ${
                queueType === "Ranked"
                  ? "bg-red-500 text-white"
                  : "bg-[#2b1d18] text-zinc-300"
              }`}
            >
              Ranked
            </button>
          </div>

          {isMatchmaking ? (
            <button
              onClick={cancelMatchmaking}
              className="bg-red-700 hover:bg-red-600 text-white font-bold px-5 py-3 rounded-lg transition"
            >
              Cancel Search
            </button>
          ) : (
            <button
              onClick={findMatch}
              className="bg-green-500 hover:bg-green-400 text-black font-bold px-5 py-3 rounded-lg transition"
            >
              Find Match
            </button>
          )}

          <button
            onClick={() => setShowCreateTable(true)}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-3 rounded-lg transition"
          >
            + Create Table
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        {rooms.map((room) => (
          <button
            key={room.id}
            onClick={() => setActiveRoom(room.id)}
            className={`px-4 py-2 rounded-lg border transition ${
              activeRoom === room.id
                ? "bg-[#463027] border-amber-400"
                : "bg-[#2a1c17] border-[#5a4034] hover:border-amber-700"
            }`}
          >
            <span className={`${room.color} font-bold`}>{room.name}</span>
            <span className="ml-2 text-zinc-400 text-sm">
              ({room.population})
            </span>
          </button>
        ))}
      </div>

      {reconnectMessage && (
        <div className="mb-4 rounded-lg border border-green-700 bg-green-950/30 px-4 py-3 text-sm text-green-300 flex justify-between items-center">
          <span>{reconnectMessage}</span>
          <button
            onClick={() => setReconnectMessage("")}
            className="text-green-200 hover:text-white"
          >
            X
          </button>
        </div>
      )}

      {matchmakingMessage && (
        <div
          className={`mb-4 rounded-lg border px-4 py-3 text-sm ${
            isMatchmaking
              ? "border-green-500 bg-green-950/30 text-green-300"
              : "border-amber-700 bg-[#241815] text-amber-300"
          }`}
        >
          {matchmakingMessage}
        </div>
      )}

      <div className="grid grid-rows-[1fr_82px_300px] gap-4 h-[82vh]">
        <section className="bg-[#241815] border border-amber-700 rounded-xl p-4 overflow-y-auto">
          <h2 className="text-2xl text-amber-300 mb-4">
            Active Tables -{" "}
            {rooms.find((room) => room.id === activeRoom)?.name} Room
          </h2>

          {visibleTables.length === 0 ? (
            <div className="text-zinc-400">
              No active tables in this room. Create one or use Find Match.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {visibleTables.map((table) => {
                const canJoin =
                  table.blackPlayer === "Open Seat" &&
                  table.opponentType === "Human";

                return (
                  <div
                    key={table.id}
                    className="bg-[#3a2721] border border-amber-800 rounded-lg p-3 hover:border-amber-400 hover:bg-[#463027] transition"
                  >
                    <div className="flex justify-between text-xs mb-2">
                      <span>Viewers: {table.spectators}</span>
                      <span className="text-amber-300">{table.gameType}</span>
                    </div>

                    <div className="flex items-center justify-between gap-3 bg-[#211512] rounded-md border border-[#5a4034] p-3">
                      <PlayerSeat name={table.redPlayer} side="red" />
                      <MiniBoard />
                      <PlayerSeat name={table.blackPlayer} side="black" />
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-zinc-300">
                        {table.status}
                      </span>

                      <div className="flex gap-2">
                        <button
                          onClick={() => watchTable(table.id)}
                          disabled={!table.allowSpectators}
                          className="bg-[#5a3a2d] hover:bg-[#6c4737] disabled:opacity-40 disabled:cursor-not-allowed text-xs px-3 py-1 rounded"
                        >
                          Watch
                        </button>

                        <button
                          onClick={() => joinTable(table.id)}
                          disabled={!canJoin}
                          className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-600 disabled:text-zinc-300 disabled:cursor-not-allowed text-black font-bold text-xs px-3 py-1 rounded"
                        >
                          {canJoin
                            ? "Join"
                            : table.opponentType === "Computer"
                            ? "CPU"
                            : "Full"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 text-[11px] text-zinc-400 flex justify-between">
                      <span>{table.timeControl}</span>
                      <span>{table.opponentType}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

                                  

<section className="rounded-xl border border-amber-700 bg-[#241815] px-4 py-3 overflow-hidden">
          <div className="flex items-center gap-4">
            <div className="shrink-0">
              <div className="text-amber-300 font-bold text-lg leading-tight">
                Events
              </div>
              <div className="text-[11px] text-zinc-500">
                Cups & brackets
              </div>
            </div>

            <div className="flex-1 flex gap-3 overflow-x-auto">
              {tournaments.length === 0 ? (
                <div className="text-zinc-500 text-sm">
                  No events live.
                </div>
              ) : (
                tournaments.map((tournament) => {
                  const joined = tournament.players.some(
                    (player) =>
                      player.screenName.toLowerCase() ===
                      currentUser.screenName.toLowerCase()
                  );

                  const canStart =
                    tournament.status === "Waiting" &&
                    tournament.players.length >= 2 &&
                    (tournament.host === currentUser.screenName ||
                      currentUser.screenName === "JT");

                  return (
                    <div
                      key={tournament.id}
                      onClick={() => setSelectedTournamentId(tournament.id)}
                      className="min-w-[360px] rounded-lg border border-[#5a4034] bg-[#1b120f] px-3 py-1.5 flex items-center gap-3 self-start cursor-pointer hover:border-amber-600 transition"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-300 font-bold truncate">
                            {tournament.name}
                          </span>

                          <span
                            className={`shrink-0 rounded px-2 py-[2px] text-[10px] font-bold ${
                              tournament.status === "Waiting"
                                ? "bg-green-950 text-green-300"
                                : tournament.status === "In Progress"
                                ? "bg-amber-950 text-amber-300"
                                : "bg-zinc-800 text-zinc-300"
                            }`}
                          >
                            {tournament.status}
                          </span>
                        </div>

                        <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-500">
                          <span>{tournament.type}</span>
                          <span>{tournament.players.length}/{tournament.maxPlayers} players</span>
                          <span>{tournament.format}</span>
                        </div>
                      </div>

                      <div className="w-24 h-2 rounded-full bg-[#2b1d18] overflow-hidden shrink-0">
                        <div
                          className="h-full bg-amber-500"
                          style={{
                            width: `${Math.min(
                              100,
                              (tournament.players.length /
                                tournament.maxPlayers) *
                                100
                            )}%`,
                          }}
                        />
                      </div>

                      {tournament.status === "Waiting" &&
                        (joined ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              leaveTournament(tournament.id);
                            }}
                            className="shrink-0 bg-red-700 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded"
                          >
                            Leave
                          </button>
                        ) : (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              joinTournament(tournament.id);
                            }}
                            disabled={
                              tournament.players.length >=
                              tournament.maxPlayers
                            }
                            className="shrink-0 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-black text-xs font-bold px-3 py-2 rounded"
                          >
                            Join
                          </button>
                        ))}

                      {canStart && (
                        <button
                          onClick={(event) => {
                              event.stopPropagation();
                              startTournament(tournament.id);
                            }}
                          className="shrink-0 bg-green-600 hover:bg-green-500 text-black text-xs font-bold px-3 py-2 rounded"
                        >
                          Start
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <button
              onClick={() => setShowCreateTournament(true)}
              className="shrink-0 bg-[#5a3a2d] hover:bg-[#6c4737] text-white text-xs font-bold px-3 py-2 rounded-lg transition"
            >
              + Event
            </button>
          </div>
        </section>

        <section className="grid grid-cols-[300px_1fr] gap-4">
          <div className="bg-[#241815] border border-amber-700 rounded-xl p-4 overflow-y-auto">
            <h2 className="text-xl text-amber-300 mb-4">Players & Ratings</h2>

            <div className="space-y-2">
                            {(() => {
                const combinedPlayers = [
                  ...(livePlayers.length > 0
                    ? livePlayers.map((player) => ({
                        name: player.screenName || "Unknown Player",
                        rating:
                          typeof player.rating === "number"
                            ? player.rating
                            : 1500,
                      }))
                    : [
                        {
                          name: currentUser.screenName,
                          rating: currentUser.rating,
                        },
                        ...leaderboardPlayers.map((player) => ({
                          name: player.screenName || "Unknown Player",
                          rating:
                            typeof player.rating === "number"
                              ? player.rating
                              : 1500,
                        })),
                      ]),
                ];

                const uniquePlayers = combinedPlayers.filter(
                  (player, index, list) =>
                    list.findIndex(
                      (item) =>
                        String(item.name || "").toLowerCase() ===
                        String(player.name || "").toLowerCase()
                    ) === index
                );

                const sortedPlayers = uniquePlayers.sort(
                  (a, b) => (b.rating || 0) - (a.rating || 0)
                );

                return sortedPlayers.map((player) => (
                  <div
                    key={player.name}
                    onClick={() => openPlayerProfile(player.name)}
                    className="flex items-center gap-3 bg-[#35231e] p-2 rounded hover:bg-[#463029] cursor-pointer"
                  >
                    <RankCircle rating={player.rating} />
                    <span className="flex-1">{player.name}</span>
                    <span className="text-zinc-400 text-sm">
                      {player.rating}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>

          <div className="bg-[#241815] border border-amber-700 rounded-xl p-4 flex flex-col">
            <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
              <div className="flex flex-col min-h-0">
                <h2 className="text-xl text-amber-300 mb-4">Lobby Chat</h2>

                <div className="flex-1 overflow-y-auto bg-[#1b120f] rounded p-3 space-y-2 text-sm">
                  {lobbyMessages.length === 0 ? (
                    <div className="text-zinc-500">No messages yet.</div>
                  ) : (
                    lobbyMessages.map((message) => (
                      <div key={message.id}>
                        <span
                          className={
                            message.sender === "System"
                              ? "text-cyan-300 font-bold"
                              : message.sender === currentUser.screenName
                              ? "text-amber-300 font-bold"
                              : "text-white font-bold"
                          }
                        >
                          {message.sender}
                          {message.sender === "JT" && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-[2px] text-[10px] font-black tracking-wide text-black shadow-[0_0_6px_rgba(251,191,36,0.45)]">
                              DEV
                            </span>
                          )}
                          :
                        </span>{" "}
                        <span className="text-zinc-100">{message.text}</span>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  <input
                    value={lobbyChatText}
                    onChange={(event) => setLobbyChatText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        sendLobbyChat();
                      }
                    }}
                    placeholder="Type message..."
                    maxLength={160}
                    className="flex-1 bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                  />

                  <button
                    onClick={sendLobbyChat}
                    className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 rounded"
                  >
                    Send
                  </button>
                </div>
              </div>

              <div className="flex flex-col min-h-0 border-l border-amber-900/60 pl-4">
                <h2 className="text-xl text-amber-300 mb-4">System Feed</h2>

                <div className="flex-1 overflow-y-auto bg-[#1b120f] rounded p-3 space-y-2 text-sm border border-[#3a2721]">
                  {systemFeedItems.length === 0 ? (
                    <div className="text-zinc-500">No announcements yet.</div>
                  ) : (
                    systemFeedItems.map((item) => (
                      <div
                        key={item.id}
                        className={
                          item.type === "ranked"
                            ? "text-amber-300"
                            : item.type === "account"
                            ? "text-purple-300"
                            : item.type === "matchmaking"
                            ? "text-orange-300"
                            : item.type === "table"
                            ? "text-zinc-200"
                            : "text-zinc-300"
                        }
                      >
                        {item.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>


      {selectedProfile && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#241815] border border-amber-700 rounded-xl p-6 w-[460px] relative shadow-2xl">
            <button
              onClick={() => setSelectedProfile(null)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white"
            >
              X
            </button>

            <div className="flex items-center gap-4 mb-5">
              <div className="h-16 w-16 rounded-full bg-[#35231e] border border-amber-700 flex items-center justify-center text-2xl font-bold text-amber-300">
                {selectedProfile.screenName.charAt(0).toUpperCase()}
              </div>

              <div>
                <h2 className="text-3xl font-bold text-amber-300">
                  {selectedProfile.screenName}
                </h2>
                <div className="text-zinc-400 text-sm">
                  Player Profile
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3">
                <div className="text-zinc-400">Rating</div>
                <div className="text-2xl font-bold text-amber-300">
                  {selectedProfile.rating}
                </div>
              </div>

              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3">
                <div className="text-zinc-400">Win Rate</div>
                <div className="text-2xl font-bold text-green-300">
                  {selectedProfile.winRate}%
                </div>
              </div>

              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3">
                <div className="text-zinc-400">Wins</div>
                <div className="text-xl font-bold text-green-300">
                  {selectedProfile.wins}
                </div>
              </div>

              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3">
                <div className="text-zinc-400">Losses</div>
                <div className="text-xl font-bold text-red-300">
                  {selectedProfile.losses}
                </div>
              </div>

              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3">
                <div className="text-zinc-400">Matches</div>
                <div className="text-xl font-bold text-zinc-100">
                  {selectedProfile.matchesPlayed}
                </div>
              </div>

              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3">
                <div className="text-zinc-400">Joined</div>
                <div className="text-sm font-bold text-zinc-100">
                  {new Date(selectedProfile.createdAt).toLocaleDateString()}
                </div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-amber-300 font-bold mb-2">
                Recent Matches
              </h3>

              <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-3 text-sm max-h-52 overflow-y-auto space-y-2">
                {!selectedProfile.recentMatches ||
                selectedProfile.recentMatches.length === 0 ? (
                  <div className="text-zinc-500">
                    No completed matches yet.
                  </div>
                ) : (
                  selectedProfile.recentMatches.slice(0, 8).map((match) => {
                    const won =
                      match.winnerName.toLowerCase() ===
                      selectedProfile.screenName.toLowerCase();

                    return (
                      <div
                        key={match.id}
                        className="rounded border border-[#3a2721] bg-[#241815] p-2"
                      >
                        <div className="flex justify-between gap-2">
                          <span
                            className={
                              won
                                ? "text-green-300 font-bold"
                                : "text-red-300 font-bold"
                            }
                          >
                            {won ? "Win" : "Loss"}
                          </span>

                          <span className="text-zinc-500 text-xs">
                            {new Date(match.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="text-zinc-200 mt-1">
                          {match.redPlayer} vs {match.blackPlayer}
                        </div>

                        <div className="text-xs text-zinc-500 mt-1">
                          {match.gameType} â€¢ {match.moveCount} moves â€¢{" "}
                          {match.reason}
                        </div>

                        {match.ratingResult && (
                          <div className="text-xs text-amber-300 mt-1">
                            Rating:{" "}
                            {won
                              ? `+${match.ratingResult.winnerDelta}`
                              : `${match.ratingResult.loserDelta}`}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {profileError && (
        <div className="fixed bottom-5 right-5 bg-red-950 border border-red-700 text-red-300 rounded-lg p-3 z-50">
          {profileError}
          <button
            onClick={() => setProfileError("")}
            className="ml-3 text-white"
          >
            X
          </button>
        </div>
      )}



      {selectedTournament && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50">
          <div className="bg-[#241815] border border-amber-700 rounded-xl p-6 w-[920px] max-h-[86vh] overflow-hidden relative shadow-2xl">
            <button
              onClick={() => setSelectedTournamentId(null)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white"
            >
              X
            </button>

            <div className="flex items-start justify-between gap-5 mb-5 pr-8">
              <div>
                <div className="text-xs uppercase tracking-wide text-zinc-500">
                  Tournament Bracket
                </div>

                <h2 className="text-3xl font-bold text-amber-300">
                  {selectedTournament.name}
                </h2>

                <div className="text-sm text-zinc-400 mt-1">
                  {selectedTournament.type} â€¢ {selectedTournament.format} â€¢{" "}
                  {selectedTournament.timeControl} â€¢ {selectedTournament.moveTimer}
                </div>
              </div>

              <div className="flex gap-3">
                <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] px-4 py-3 text-center">
                  <div className="text-xs text-zinc-500">Players</div>
                  <div className="text-xl font-bold text-white">
                    {selectedTournament.players.length}/{selectedTournament.maxPlayers}
                  </div>
                </div>

                <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] px-4 py-3 text-center">
                  <div className="text-xs text-zinc-500">Status</div>
                  <div
                    className={
                      selectedTournament.status === "Waiting"
                        ? "text-green-300 font-bold"
                        : selectedTournament.status === "In Progress"
                        ? "text-amber-300 font-bold"
                        : "text-zinc-300 font-bold"
                    }
                  >
                    {selectedTournament.status}
                  </div>
                </div>

                <div className="rounded-lg bg-[#1b120f] border border-[#3a2721] px-4 py-3 text-center">
                  <div className="text-xs text-zinc-500">Round</div>
                  <div className="text-xl font-bold text-amber-300">
                    {Math.max(1, selectedTournament.round || 1)}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-[260px_1fr] gap-5 min-h-[460px] max-h-[60vh]">
              <aside className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-4 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-amber-300 font-bold">
                    Entrants
                  </h3>

                  <span className="text-xs text-zinc-500">
                    {selectedTournament.players.length}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                  {selectedTournament.players.length === 0 ? (
                    <div className="text-sm text-zinc-500">
                      No players have joined yet.
                    </div>
                  ) : (
                    selectedTournament.players.map((player, index) => (
                      <div
                        key={player.screenName}
                        className="rounded bg-[#2b1d18] border border-[#3a2721] p-2 flex items-center justify-between text-sm"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-zinc-500 text-xs">
                            #{index + 1}
                          </span>
                          <span className="truncate">
                            {player.screenName}
                          </span>
                        </div>

                        <span className="text-zinc-500 text-xs">
                          {player.rating}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-4 flex gap-2">
                  {selectedTournament.status === "Waiting" &&
                    (selectedTournament.players.some(
                      (player) =>
                        player.screenName.toLowerCase() ===
                        currentUser.screenName.toLowerCase()
                    ) ? (
                      <button
                        onClick={() => leaveTournament(selectedTournament.id)}
                        className="flex-1 bg-red-700 hover:bg-red-600 text-white font-bold py-2 rounded text-sm"
                      >
                        Leave
                      </button>
                    ) : (
                      <button
                        onClick={() => joinTournament(selectedTournament.id)}
                        disabled={
                          selectedTournament.players.length >=
                          selectedTournament.maxPlayers
                        }
                        className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-400 text-black font-bold py-2 rounded text-sm"
                      >
                        Join
                      </button>
                    ))}

                  {selectedTournament.status === "Waiting" &&
                    selectedTournament.players.length >= 2 &&
                    (selectedTournament.host === currentUser.screenName ||
                      currentUser.screenName === "JT") && (
                      <button
                        onClick={() => startTournament(selectedTournament.id)}
                        className="flex-1 bg-green-600 hover:bg-green-500 text-black font-bold py-2 rounded text-sm"
                      >
                        Start
                      </button>
                    )}
                </div>
              </aside>

              <section className="rounded-lg bg-[#1b120f] border border-[#3a2721] p-4 overflow-x-auto overflow-y-auto">
                {selectedTournament.bracket.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center">
                    <div>
                      <div className="text-2xl font-bold text-amber-300">
                        Bracket Not Started
                      </div>
                      <div className="text-sm text-zinc-500 mt-2 max-w-[420px]">
                        Once the host starts the tournament, the single-elimination
                        bracket will appear here with matchups, BYEs, and advancing
                        players.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-5 min-w-max">
                    {selectedTournament.bracket.map((round) => (
                      <div key={round.round} className="w-64">
                        <div className="text-amber-300 font-bold mb-3">
                          {round.name}
                        </div>

                        <div className="space-y-3">
                          {round.matches.map((match) => (
                            <div
                              key={match.id}
                              className="rounded-lg border border-[#5a4034] bg-[#241815] p-3"
                            >
                              <div className="flex items-center justify-between text-xs text-zinc-500 mb-2">
                                <span>Match {match.matchNumber}</span>
                                <span>{match.status}</span>
                              </div>

                              <div
                                className={`rounded px-2 py-1 mb-1 ${
                                  match.winner?.screenName ===
                                  match.player1?.screenName
                                    ? "bg-green-950/50 text-green-300"
                                    : "bg-[#1b120f] text-zinc-200"
                                }`}
                              >
                                {match.player1?.screenName || "BYE"}
                              </div>

                              <div
                                className={`rounded px-2 py-1 ${
                                  match.winner?.screenName ===
                                  match.player2?.screenName
                                    ? "bg-green-950/50 text-green-300"
                                    : "bg-[#1b120f] text-zinc-200"
                                }`}
                              >
                                {match.player2?.screenName || "BYE"}
                              </div>

                              {match.winner && (
                                <div className="text-xs text-amber-300 mt-2">
                                  {match.winner.screenName} advances
                                </div>
                              )}

                              {match.tableId && (
                                <button
                                  onClick={() => watchTable(match.tableId!)}
                                  className="mt-2 w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold py-1 rounded"
                                >
                                  Watch Match
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      {showCreateTournament && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#241815] border border-amber-700 rounded-xl p-6 w-[460px] relative shadow-2xl">
            <button
              onClick={() => setShowCreateTournament(false)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white"
            >
              X
            </button>

            <h2 className="text-2xl font-bold text-amber-300 mb-1">
              Create Tournament
            </h2>
            <p className="text-sm text-zinc-400 mb-5">
              Phase 1 supports single-elimination bracket events.
            </p>

            <div className="space-y-4 text-sm">
              <label className="block">
                <span className="text-zinc-300">Tournament Name</span>
                <input
                  value={newTournamentName}
                  onChange={(event) =>
                    setNewTournamentName(event.target.value)
                  }
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                />
              </label>

              <label className="block">
                <span className="text-zinc-300">Tournament Type</span>
                <select
                  value={newTournamentType}
                  onChange={(event) =>
                    setNewTournamentType(
                      event.target.value as "Casual" | "Ranked"
                    )
                  }
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                >
                  <option>Casual</option>
                  <option>Ranked</option>
                </select>
              </label>

              <label className="block">
                <span className="text-zinc-300">Max Players</span>
                <select
                  value={newTournamentMaxPlayers}
                  onChange={(event) =>
                    setNewTournamentMaxPlayers(Number(event.target.value))
                  }
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                >
                  <option value={4}>4 Players</option>
                  <option value={8}>8 Players</option>
                  <option value={16}>16 Players</option>
                </select>
              </label>

              <button
                onClick={createTournament}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold py-3 rounded-lg"
              >
                Create Tournament
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateTable && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-[#241815] border border-amber-700 rounded-xl p-6 w-[500px] relative">
            <button
              onClick={() => setShowCreateTable(false)}
              className="absolute top-3 right-3 text-zinc-400 hover:text-white"
            >
              X
            </button>

            <h2 className="text-2xl font-bold text-amber-300 mb-1">
              Create Table
            </h2>
            <p className="text-sm text-zinc-400 mb-5">
              Set your table rules, then sit down and wait for a player.
            </p>

            <div className="space-y-4 text-sm">
              <label className="block">
                <span className="text-zinc-300">Opponent Type</span>
                <select
                  value={opponentType}
                  onChange={(event) => {
                    const selectedOpponentType = event.target.value as
                      | "Human"
                      | "Computer";

                    setOpponentType(selectedOpponentType);

                    if (selectedOpponentType === "Computer") {
                      setGameType("Casual");
                      setRatedOnly(false);
                      setComputerSkill("Beginner Bot");
                    }
                  }}
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                >
                  <option>Human</option>
                  <option>Computer</option>
                </select>
              </label>

              {opponentType === "Computer" && (
                                <label className="block">
                  <span className="text-zinc-300">Computer Skill</span>
                  <select
                    value={computerSkill}
                    onChange={(event) => setComputerSkill(event.target.value)}
                    className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                  >
                    <option>Beginner Bot</option>
                    <option>Intermediate Bot</option>
                    <option>Advanced Bot</option>
                    <option>Expert Bot</option>
                    <option>Master Bot</option>
                  </select>

                  <div className="text-xs text-zinc-500 mt-1">
                    {computerSkill === "Master Bot"
                      ? "Master Bot uses the deepest tactical search and is the strongest unranked CPU challenge."
                      : computerSkill === "Expert Bot"
                      ? "Expert Bot is a strong fixed-difficulty CPU."
                      : computerSkill === "Advanced Bot"
                      ? "Advanced Bot uses shallow tactical search."
                      : computerSkill === "Intermediate Bot"
                      ? "Intermediate Bot plays cleaner than beginner but still makes mistakes."
                      : "Beginner Bot is forgiving and best for practice."}
                  </div>
                </label>
              )}

              <label className="block">
                <span className="text-zinc-300">Game Type</span>
                <select
                  value={gameType}
                  onChange={(event) => setGameType(event.target.value)}
                  disabled={opponentType === "Computer"}
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none disabled:opacity-70"
                >
                  <option>Casual</option>
                  {opponentType === "Human" && (
                    <>

      <style jsx global>{`
        @media (max-width: 768px) {
          html,
          body {
            overflow-x: hidden;
            background: #160d0b;
          }

          body {
            touch-action: manipulation;
          }

          input,
          button,
          select,
          textarea {
            font-size: 16px !important;
          }

          /* Main page shell */
          .min-h-screen.bg-\[\#160d0b\].text-white {
            padding: 12px !important;
          }

          /* Header: stack into phone-friendly rows */
          .min-h-screen.bg-\[\#160d0b\].text-white > div:first-child {
            display: flex !important;
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
          }

          .min-h-screen.bg-\[\#160d0b\].text-white > div:first-child h1 {
            font-size: 40px !important;
            line-height: 0.9 !important;
          }

          .min-h-screen.bg-\[\#160d0b\].text-white > div:first-child > div:last-child {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 8px !important;
            width: 100% !important;
          }

          .min-h-screen.bg-\[\#160d0b\].text-white > div:first-child > div:last-child > * {
            width: 100% !important;
            min-height: 44px !important;
          }

          .min-h-screen.bg-\[\#160d0b\].text-white > div:first-child > div:last-child button {
            min-height: 44px !important;
          }

          /* Room tabs become swipeable pills */
          .min-h-screen.bg-\[\#160d0b\].text-white > div:nth-child(2) {
            display: flex !important;
            overflow-x: auto !important;
            gap: 8px !important;
            padding-bottom: 4px !important;
            -webkit-overflow-scrolling: touch;
          }

          .min-h-screen.bg-\[\#160d0b\].text-white > div:nth-child(2) button {
            flex: 0 0 auto !important;
            min-height: 44px !important;
            padding: 10px 14px !important;
          }

          /* Main lobby grid: stack sections vertically */
          .grid.h-\[82vh\],
          .grid.grid-rows-\[1fr_150px_82px_300px\],
          .grid.grid-rows-\[1fr_82px_300px\],
          .grid.grid-rows-\[1fr_76px_300px\] {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            gap: 12px !important;
          }

          /* General cards */
          section {
            width: 100% !important;
            max-width: 100% !important;
          }

          section.rounded-xl,
          section.bg-\[\#241815\] {
            padding: 12px !important;
          }

          section h2 {
            font-size: 20px !important;
          }

          /* Active tables should not be huge empty space on mobile */
          section:has(h2) {
            min-height: auto !important;
          }

          section:has(h2.text-2xl) {
            max-height: none !important;
          }

          /* Active table cards */
          .grid.grid-cols-2,
          .grid.grid-cols-3,
          .grid.grid-cols-\[300px_1fr\] {
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
          }

          /* Featured match compresses */
          section:has(.uppercase.tracking-wide) {
            min-height: auto !important;
          }

          section:has(.uppercase.tracking-wide) > div {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 12px !important;
          }

          /* Events bar: swipe horizontally, smaller and centered */
          section:has(button):has(.text-amber-300.font-bold.text-lg) > div {
            align-items: stretch !important;
          }

          .min-w-\[360px\] {
            min-width: 280px !important;
            max-width: 280px !important;
          }

          .w-24 {
            width: 48px !important;
          }

          /* Bottom lobby: players + chat/feed stack */
          .grid.grid-cols-\[300px_1fr\] {
            display: flex !important;
            flex-direction: column !important;
          }

          .grid.grid-cols-\[300px_1fr\] > aside {
            max-height: 180px !important;
            overflow-y: auto !important;
          }

          .grid.grid-cols-\[300px_1fr\] > section {
            min-height: 420px !important;
          }

          .grid.grid-cols-\[300px_1fr\] > section > div {
            display: flex !important;
            flex-direction: column !important;
            gap: 12px !important;
          }

          .grid.grid-cols-\[300px_1fr\] input {
            min-height: 46px !important;
          }

          .grid.grid-cols-\[300px_1fr\] button {
            min-height: 46px !important;
          }

          /* Login/Register card */
          .min-h-screen.bg-\[\#160d0b\] .w-\[540px\] {
            width: calc(100vw - 24px) !important;
            max-width: calc(100vw - 24px) !important;
            padding: 20px !important;
          }

          .min-h-screen.bg-\[\#160d0b\] .w-\[540px\] h1 {
            font-size: 42px !important;
          }

          /* Live game layout: stack board and info */
          .grid.grid-cols-\[1fr_340px\],
          .grid.grid-cols-\[280px_1fr_340px\],
          .grid.grid-cols-\[300px_1fr_340px\] {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            gap: 12px !important;
          }

          /* Game header/buttons */
          .flex.justify-end.gap-3,
          .flex.items-center.justify-between {
            flex-wrap: wrap !important;
            gap: 8px !important;
          }

          /* Board sizing on phones */
          .grid.grid-cols-8.grid-rows-8 {
            max-width: calc(100vw - 48px) !important;
            max-height: calc(100vw - 48px) !important;
          }

          .w-\[560px\],
          .h-\[560px\] {
            width: calc(100vw - 48px) !important;
            height: calc(100vw - 48px) !important;
          }

          .w-\[520px\],
          .h-\[520px\] {
            width: calc(100vw - 48px) !important;
            height: calc(100vw - 48px) !important;
          }

          /* Checker pieces scale down */
          .w-14.h-14,
          .h-14.w-14 {
            width: 70% !important;
            height: 70% !important;
          }

          .w-12.h-12,
          .h-12.w-12 {
            width: 68% !important;
            height: 68% !important;
          }

          /* Side panels become comfortable cards */
          aside {
            width: 100% !important;
            max-width: 100% !important;
          }

          aside .text-2xl {
            font-size: 20px !important;
          }

          aside .grid {
            gap: 8px !important;
          }

          /* Modals fit phone screens */
          .fixed.inset-0 > .w-\[920px\],
          .fixed.inset-0 > .w-\[460px\],
          .fixed.inset-0 > .w-\[540px\] {
            width: calc(100vw - 24px) !important;
            max-width: calc(100vw - 24px) !important;
            max-height: 88vh !important;
            overflow-y: auto !important;
            padding: 18px !important;
          }

          .fixed.inset-0 .grid.grid-cols-\[260px_1fr\] {
            display: flex !important;
            flex-direction: column !important;
          }

          /* Make action buttons finger friendly */
          button {
            border-radius: 10px !important;
          }

          /* Keep chat input visible and easy to tap */
          input[placeholder="Type message..."],
          input[placeholder="Table message..."] {
            height: 46px !important;
          }

          /* Hide decorative/empty dead space on mobile */
          .opacity-20 {
            display: none !important;
          }
        }
  

      /* CHEXKERS MOBILE LOBBY CLEANUP V3 START */
      @media (max-width: 900px) {
        html,
        body {
          width: 100% !important;
          max-width: 100vw !important;
          overflow-x: hidden !important;
          background: #17100d !important;
        }

        * {
          box-sizing: border-box;
        }

        input,
        button,
        select,
        textarea {
          font-size: 16px !important;
        }

        body {
          touch-action: manipulation;
        }

        main {
          width: 100% !important;
          max-width: 100vw !important;
          overflow-x: hidden !important;
          padding: 16px !important;
        }

        main > * {
          max-width: 100% !important;
          min-width: 0 !important;
        }

        /* Mobile lobby header */
        main > div:first-child.flex.items-center.justify-between {
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 12px !important;
          margin-bottom: 14px !important;
        }

        main > div:first-child.flex.items-center.justify-between > div:first-child {
          width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
        }

        main > div:first-child.flex.items-center.justify-between h1 {
          font-size: clamp(34px, 11.5vw, 52px) !important;
          line-height: 0.92 !important;
          white-space: nowrap !important;
        }

        main > div:first-child.flex.items-center.justify-between > div:last-child {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 10px !important;
          width: 100% !important;
          min-width: 0 !important;
        }

        main > div:first-child.flex.items-center.justify-between > div:last-child > * {
          width: 100% !important;
          min-width: 0 !important;
          max-width: 100% !important;
          min-height: 54px !important;
        }

        main > div:first-child.flex.items-center.justify-between > div:last-child > div,
        main > div:first-child.flex.items-center.justify-between > div:last-child > button {
          border-radius: 10px !important;
          padding: 12px !important;
        }

        /* Queue control gets full width and no hidden ranked button */
        main > div:first-child.flex.items-center.justify-between > div:last-child > div:has(button) {
          grid-column: 1 / -1 !important;
          display: grid !important;
          grid-template-columns: auto 1fr 1fr !important;
          align-items: center !important;
          gap: 8px !important;
          overflow: hidden !important;
        }

        main > div:first-child.flex.items-center.justify-between > div:last-child > div:has(button) button {
          width: 100% !important;
          min-width: 0 !important;
          white-space: nowrap !important;
          padding: 12px 8px !important;
        }

        main > div:first-child.flex.items-center.justify-between > div:last-child > button {
          font-size: 18px !important;
          font-weight: 800 !important;
        }

        /* Keep Find/Create clean as two large buttons */
        main > div:first-child.flex.items-center.justify-between > div:last-child > button:nth-last-child(2),
        main > div:first-child.flex.items-center.justify-between > div:last-child > button:last-child {
          min-height: 58px !important;
        }

        /* Room tabs */
        main > div.flex.gap-3.mb-4 {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          gap: 10px !important;
          margin-bottom: 14px !important;
          width: 100% !important;
        }

        main > div.flex.gap-3.mb-4 button {
          width: 100% !important;
          min-width: 0 !important;
          min-height: 54px !important;
          padding: 12px 10px !important;
          font-size: 17px !important;
          line-height: 1.1 !important;
          white-space: normal !important;
        }

        /* Main lobby stack */
        .grid.grid-rows-\[1fr_82px_300px\],
        .grid.grid-rows-\[1fr_76px_300px\],
        .grid.grid-rows-\[1fr_300px\],
        .grid.h-\[82vh\] {
          display: flex !important;
          flex-direction: column !important;
          height: auto !important;
          min-height: 0 !important;
          gap: 14px !important;
          width: 100% !important;
          max-width: 100% !important;
          overflow: visible !important;
        }

        .grid.grid-rows-\[1fr_82px_300px\] > section:first-child,
        .grid.grid-rows-\[1fr_76px_300px\] > section:first-child,
        .grid.h-\[82vh\] > section:first-child {
          min-height: 128px !important;
          height: auto !important;
          max-height: none !important;
        }

        section,
        aside {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          overflow: hidden !important;
          padding: 14px !important;
          border-radius: 14px !important;
        }

        section h2,
        aside h2 {
          font-size: 24px !important;
          line-height: 1.12 !important;
        }

        /* Generic grid stacking */
        .grid.grid-cols-2,
        .grid.grid-cols-3,
        .grid.grid-cols-\[300px_1fr\],
        .grid.grid-cols-\[1fr_1fr\],
        .grid.grid-cols-\[1fr_340px\],
        .grid.grid-cols-\[280px_1fr_340px\],
        .grid.grid-cols-\[270px_1fr_340px\],
        .grid.grid-cols-\[300px_1fr_340px\] {
          display: flex !important;
          flex-direction: column !important;
          gap: 14px !important;
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          height: auto !important;
        }

        /* Events: put card and +Event button in clean vertical layout */
        section:has(.text-amber-300.font-bold.text-lg) > div,
        section:has(button):has(.text-amber-300.font-bold.text-lg) > div {
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 10px !important;
          width: 100% !important;
          min-width: 0 !important;
        }

        .min-w-\[360px\],
        .min-w-\[320px\],
        .min-w-\[300px\] {
          min-width: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
        }

        section:has(.text-amber-300.font-bold.text-lg) button,
        section:has(button):has(.text-amber-300.font-bold.text-lg) button {
          width: 100% !important;
          min-height: 52px !important;
        }

        /* Players, lobby chat, feed: true stacked card layout */
        .grid.grid-cols-\[300px_1fr\] > aside,
        .grid.grid-cols-\[300px_1fr\] > section {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
        }

        .grid.grid-cols-\[300px_1fr\] > aside {
          max-height: none !important;
          overflow: visible !important;
        }

        .grid.grid-cols-\[300px_1fr\] > section {
          min-height: auto !important;
          overflow: hidden !important;
        }

        .grid.grid-cols-\[300px_1fr\] > section > div {
          display: flex !important;
          flex-direction: column !important;
          gap: 14px !important;
          height: auto !important;
          width: 100% !important;
          min-width: 0 !important;
        }

        .grid.grid-cols-\[300px_1fr\] > section > div > div {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 0 !important;
          min-height: auto !important;
          border-left: 0 !important;
          padding-left: 0 !important;
        }

        .grid.grid-cols-\[300px_1fr\] input {
          min-height: 52px !important;
          min-width: 0 !important;
        }

        .grid.grid-cols-\[300px_1fr\] button {
          min-height: 52px !important;
        }

        /* Prevent any wide child from forcing sideways page */
        [class*="min-w-"],
        [class*="w-\["] {
          max-width: 100% !important;
        }

        .fixed.inset-0 {
          padding: 12px !important;
          align-items: flex-start !important;
          overflow-y: auto !important;
        }

        .fixed.inset-0 > div {
          width: 100% !important;
          max-width: 100% !important;
          max-height: 90dvh !important;
          overflow-y: auto !important;
        }
      }

      @media (max-width: 900px) and (orientation: landscape) {
        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) {
          padding: 10px 18px !important;
        }

        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) > div:first-child.flex.items-center.justify-between {
          display: grid !important;
          grid-template-columns: 1fr 1.15fr !important;
          align-items: center !important;
          gap: 12px !important;
        }

        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) > div:first-child.flex.items-center.justify-between h1 {
          font-size: clamp(32px, 6vw, 46px) !important;
        }

        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) > div:first-child.flex.items-center.justify-between > div:last-child {
          grid-template-columns: 1fr 1fr !important;
          gap: 8px !important;
        }

        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) > div:first-child.flex.items-center.justify-between > div:last-child > div:has(button) {
          grid-column: 1 / -1 !important;
          grid-template-columns: auto 1fr 1fr !important;
        }

        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) > div.flex.gap-3.mb-4 {
          display: grid !important;
          grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
          gap: 8px !important;
        }

        main:not(:has(.grid-cols-\[minmax\(280px\,58vh\)_1fr\])) > div.flex.gap-3.mb-4 button {
          min-width: 0 !important;
          width: 100% !important;
          font-size: 14px !important;
          min-height: 46px !important;
        }

        .grid.grid-rows-\[1fr_82px_300px\] > section:first-child,
        .grid.grid-rows-\[1fr_76px_300px\] > section:first-child,
        .grid.h-\[82vh\] > section:first-child {
          min-height: 96px !important;
        }
      }
      /* CHEXKERS MOBILE LOBBY CLEANUP V3 END */

    `}</style>

                      <option>Ranked</option>
                      <option>Blitz</option>
                      <option>Ranked Blitz</option>
                    </>
                  )}
                </select>

                {opponentType === "Computer" && (
                  <div className="text-xs text-zinc-500 mt-1">
                    Bot games are always casual/unranked.
                  </div>
                )}
              </label>

              <label className="block">
                <span className="text-zinc-300">Total Game Time</span>
                <select
                  value={timeControl}
                  onChange={(event) => setTimeControl(event.target.value)}
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                >
                  <option>5 Minutes</option>
                  <option>10 Minutes</option>
                  <option>15 Minutes</option>
                  <option>30 Minutes</option>
                  <option>No Timer</option>
                </select>
              </label>

              <label className="block">
                <span className="text-zinc-300">Move Timer</span>
                <select
                  value={moveTimer}
                  onChange={(event) => setMoveTimer(event.target.value)}
                  className="mt-1 w-full bg-[#2b1d18] border border-[#5a4034] rounded px-3 py-2 outline-none"
                >
                  <option>30 Seconds</option>
                  <option>60 Seconds</option>
                  <option>90 Seconds</option>
                  <option>No Move Timer</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 bg-[#35231e] p-3 rounded">
                  <input
                    type="checkbox"
                    checked={allowSpectators}
                    onChange={(event) =>
                      setAllowSpectators(event.target.checked)
                    }
                  />
                  Allow spectators
                </label>

                <label className="flex items-center gap-2 bg-[#35231e] p-3 rounded">
                  <input
                    type="checkbox"
                    checked={spectatorChat}
                    onChange={(event) => setSpectatorChat(event.target.checked)}
                  />
                  Spectator chat
                </label>

                <label className="flex items-center gap-2 bg-[#35231e] p-3 rounded">
                  <input
                    type="checkbox"
                    checked={opponentType === "Computer" ? false : ratedOnly}
                    disabled={opponentType === "Computer"}
                    onChange={(event) => setRatedOnly(event.target.checked)}
                  />
                  Rated players only
                </label>

                <label className="flex items-center gap-2 bg-[#35231e] p-3 rounded">
                  <input
                    type="checkbox"
                    checked={privateTable}
                    onChange={(event) => setPrivateTable(event.target.checked)}
                  />
                  Private table
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  onClick={() => setShowCreateTable(false)}
                  className="bg-[#5a3a2d] hover:bg-[#6c4737] px-4 py-2 rounded"
                >
                  Cancel
                </button>

                <button
                  onClick={createTable}
                  className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-5 py-2 rounded"
                >
                  Sit & Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
