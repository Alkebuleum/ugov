import { ethers } from "ethers"

export const DAO_ABI = [
    // Errors
    'error OnlyAdmin()', 'error OnlyGovernance()', 'error LenMismatch()', 'error VotingNotWindow()',
    'error AlreadyVoted()', 'error NoPower()', 'error VotingNotEnded()', 'error NotVoting()',
    'error AlreadyExecuted()', 'error NotSucceeded()', 'error NotQueued()', 'error BadId()',
    'error NotSubmitted()', 'error Held()', 'error TargetDone()', 'error BadCancelId()',
    'error Reentrancy()', 'error OnlyProposer()', 'error AlreadyQueuedOrExecuted()',
    'error BadBps()', 'error AddrZero()',

    // Views / state
    'function nextLocalId() view returns (uint64)',
    'function state(uint64 id) view returns (uint8)',
    'function getWindow(uint64 id) view returns (uint48 voteStart, uint48 voteEnd, uint16 quorumBps)',
    'function getTally(uint64 id) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)',
    'function getActions(uint64 id) view returns (address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)',
    'function token() view returns (address)',
    'function admin() view returns (address)',
    'function treasury() view returns (address)',
    'function bond() view returns (address)',
    'function minBond() view returns (uint256)',
    'function defeatedSlashBps() view returns (uint16)',
    'function votingDelayBlocks() view returns (uint32)',
    'function votingPeriodBlocks() view returns (uint32)',
    'function quorumBps() view returns (uint16)',
    'function opIdOf(uint64) view returns (bytes32)',
    'function holdsTarget(uint64) view returns (uint64)',
    'function holdCount(uint64) view returns (uint32)',

    // Config
    'function setVotingConfig(uint32,uint32,uint16)',
    'function setAdmin(address)',
    'function setVoteToken(address)',
    'function setBondManager(address)',
    'function setBondParams(uint256,uint16)',

    // Draft / submit
    'function createDraft(bytes32 offchainRef) returns (uint64 id)',
    'function submitForVote(uint64 id,address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash,uint64 cancelProposalId) payable',

    // Voting / lifecycle
    'function castVote(uint64 id,uint8 support)',
    'function finalize(uint64 id)',
    'function queue(uint64 id)',
    'function execute(uint64 id)',
    'function cancelByAuthor(uint64 id)',

    // Events
    'event DraftReserved(uint64 indexed localId,address indexed proposer,bytes32 indexed offchainRef)',
    'event VotingStarted(uint64 indexed localId,uint48 startBlock,uint48 endBlock,uint16 quorumBps)',
    'event VoteCast(uint64 indexed localId,address indexed voter,uint8 support,uint256 weight)',
    'event Finalized(uint64 indexed localId,bool succeeded,uint256 forVotes,uint256 againstVotes,uint256 abstainVotes,uint256 quorum)',
    'event Queued(uint64 indexed localId)',
    'event QueuedWithOp(uint64 indexed localId,bytes32 opId)',
    'event Executed(uint64 indexed localId)',
    'event TargetCanceled(uint64 indexed targetId,uint64 indexed byEmergencyId)',
    'event CanceledByAuthor(uint64 indexed localId,address indexed proposer,uint16 slashBps)',
    'event DaoParamsSet(address indexed dao,uint256 minBond,uint16 defeatedSlashBps)',
] as const


export const TREASURY_ABI = [
    // getters
    'function delay() view returns (uint32)',
    'function gracePeriod() view returns (uint32)',
    'function dao() view returns (address)',
    'function deployer() view returns (address)',
    'function operations(bytes32) view returns (bool queued, uint64 eta)',

    // queue / cancel / execute
    'function queue(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) returns (bytes32)',
    'function cancel(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash)',
    'function execute(address[] targets,uint256[] values,bytes[] calldatas,bytes32 descriptionHash) payable returns (bytes[])',

    // self-admin
    'function updateDelay(uint32)',
    'function updateGracePeriod(uint32)',
] as const

export const BOND_MGR_ABI = [
    'function keyOf(address dao,uint256 localId) pure returns (bytes32)',
    'function bonds(bytes32) view returns (address payer,address sink,uint256 amount,bool locked,bool settled)',
    'function postBondFromDAO(address dao,uint256 localId,address payer,address sink,uint256 daoMinBond) payable',
    'function onDefeated(address dao,uint256 localId,uint16 slashBps)',
    'function onExecuted(address dao,uint256 localId)',
    'function onCanceledByEmergency(address dao,uint256 localId)',
    'function onCanceledByAuthor(address dao,uint256 localId,uint16 slashBps)',
    'event BondPosted(bytes32 indexed key,address indexed dao,uint256 indexed localId,address payer,address sink,uint256 amount)',
    'event BondRefunded(bytes32 indexed key,address indexed dao,uint256 indexed localId,uint256 amount)',
    'event BondSlashed(bytes32 indexed key,address indexed dao,uint256 indexed localId,uint256 amount,string reason)',
] as const



export const IVOTES_ABI = [
    'function getPastVotes(address account, uint256 blockNumber) view returns (uint256)',
] as const

export const TOKEN_ABI = [
    'function delegates(address) view returns (address)',
    'function delegate(address delegatee)',
    'function getVotes(address account) view returns (uint256)',
    'function getPastVotes(address account, uint256 blockNumber) view returns (uint256)',
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
] as const

export const ERC20_IFACE = new ethers.Interface([
    'function transfer(address to,uint256 amount)',
])

export const ERC20_ABI = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
] as const

