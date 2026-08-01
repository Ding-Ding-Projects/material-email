import type {
  Pop3AccountOptions,
  Pop3CapabilityStatus,
  Pop3DemoMessage,
  Pop3FoundationSnapshot,
  Pop3SessionEvent,
  Pop3SessionState,
  Pop3StateTransition,
} from "../shared/contracts.js";

const NEXT_STATE: Readonly<Partial<Record<Pop3SessionState, Readonly<Partial<Record<Pop3SessionEvent, Pop3SessionState>>>>>> =
  Object.freeze({
    idle: Object.freeze({ start: "connecting", "reject-live-network": "unsupported" }),
    connecting: Object.freeze({ greeting: "authorization" }),
    authorization: Object.freeze({ "demo-authorized": "transaction" }),
    transaction: Object.freeze({ "retrieve-list": "transaction", quit: "update" }),
    update: Object.freeze({ disconnect: "disconnected" }),
  });

const LOCAL_DEMO_CAPABILITIES: readonly Pop3CapabilityStatus[] = Object.freeze([
  Object.freeze({ name: "UIDL", available: true, used: true }),
  Object.freeze({ name: "TOP", available: true, used: false }),
  Object.freeze({ name: "STLS", available: false, used: false }),
  Object.freeze({ name: "PIPELINING", available: false, used: false }),
  Object.freeze({ name: "DELE", available: false, used: false }),
]);

const LOCAL_DEMO_MESSAGES: readonly Pop3DemoMessage[] = Object.freeze([
  Object.freeze({ uidl: "material-pop3-demo-001", subject: "Welcome to the bounded POP3 demo", octets: 1_248 }),
  Object.freeze({ uidl: "material-pop3-demo-002", subject: "UIDL keeps the local fixture order stable", octets: 2_016 }),
  Object.freeze({ uidl: "material-pop3-demo-003", subject: "No deletion or server synchronization occurred", octets: 1_792 }),
]);

export class Pop3StateMachine {
  #state: Pop3SessionState = "idle";
  readonly #transitions: Pop3StateTransition[] = [];

  get state(): Pop3SessionState {
    return this.#state;
  }

  transition(event: Pop3SessionEvent): Pop3SessionState {
    const from = this.#state;
    const to = NEXT_STATE[from]?.[event];
    if (!to) throw new Error(`POP3 foundation event ${event} is not valid while the session is ${from}.`);
    this.#state = to;
    this.#transitions.push({ sequence: this.#transitions.length + 1, from, event, to });
    return to;
  }

  transitions(): Pop3StateTransition[] {
    return this.#transitions.map(item => ({ ...item }));
  }
}

const capabilities = (liveNetwork: boolean): Pop3CapabilityStatus[] =>
  liveNetwork
    ? LOCAL_DEMO_CAPABILITIES.map(item => ({ ...item, available: false, used: false }))
    : LOCAL_DEMO_CAPABILITIES.map(item => ({ ...item }));

export const runPop3Foundation = (options: Pop3AccountOptions): Pop3FoundationSnapshot => {
  const machine = new Pop3StateMachine();
  if (options.transport === "live-network") {
    machine.transition("reject-live-network");
    return {
      transport: options.transport,
      state: machine.state,
      capabilities: capabilities(true),
      transitions: machine.transitions(),
      messages: [],
      serverContacted: false,
      credentialsUsed: false,
      deletionAttempted: false,
      fullSynchronization: false,
      boundary: "live-network-unsupported",
    };
  }

  machine.transition("start");
  machine.transition("greeting");
  machine.transition("demo-authorized");
  machine.transition("retrieve-list");
  const messages = LOCAL_DEMO_MESSAGES.slice(0, options.messageLimit).map(message => ({ ...message }));
  machine.transition("quit");
  machine.transition("disconnect");

  return {
    transport: options.transport,
    state: machine.state,
    capabilities: capabilities(false),
    transitions: machine.transitions(),
    messages,
    serverContacted: false,
    credentialsUsed: false,
    deletionAttempted: false,
    fullSynchronization: false,
    boundary: "local-demo-only",
  };
};
