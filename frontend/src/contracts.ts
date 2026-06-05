// Contract addresses — update from deployments/testnet.json after redeploy
export const ADDRESSES = {
  SybilRegistry: '0x465303a0bd8668e144913dba8e7f4f7655b58500' as `0x${string}`,
  LaunchPool:    '0x36754cde2259b00f99c050ba07262e40b89dc3aa' as `0x${string}`,
  VestingVault:  '0x88d6df61b96ceb36065bca3d27e423bfa8578710' as `0x${string}`,
  MockERC20:     '0x55fc873724a0cc70bf9ec121843dbef409e8c137' as `0x${string}`,
  TrustOracle:   '0x9d4efc0305153231027e729b5de6f58b0973ff18' as `0x${string}`,
} as const

export const TRUST_ORACLE_ABI = [
  {
    name: 'getProject', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'uint256' }],
    outputs: [{ type: 'tuple', components: [
      { name: 'name', type: 'string' }, { name: 'domain', type: 'string' },
      { name: 'score', type: 'uint8' }, { name: 'status', type: 'uint8' }, { name: 'updatedAt', type: 'uint256' },
    ]}],
  },
  { name: 'registerProject',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'poolId', type: 'uint256' }, { name: 'name', type: 'string' }, { name: 'domain', type: 'string' }], outputs: [] },
  { name: 'requestTrustScore', type: 'function', stateMutability: 'payable',    inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [] },
  { name: 'ProjectRegistered', type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'name', type: 'string', indexed: false }, { name: 'domain', type: 'string', indexed: false }] },
  { name: 'TrustRequested',    type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'requestId', type: 'uint256', indexed: false }] },
  { name: 'TrustScored',       type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'score', type: 'uint8', indexed: false }] },
  { name: 'TrustFailed',       type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }] },
] as const

// These ABIs were verified against the compiled artifacts in abis.json
// They are kept as `as const` so wagmi/viem can infer correct TypeScript types.

export const SYBIL_REGISTRY_ABI = [
  { name: 'TOTAL_DEPOSIT',     type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'ATTESTATION_TTL',   type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'JSON_API_AGENT_ID', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'PLATFORM',          type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    name: 'attestations', type: 'function', stateMutability: 'view',
    inputs:  [{ name: '', type: 'address' }],
    outputs: [{ name: 'score', type: 'uint8' }, { name: 'timestamp', type: 'uint256' }, { name: 'expiresAt', type: 'uint256' }, { name: 'exists', type: 'bool' }],
  },
  {
    name: 'isVerified', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'wallet', type: 'address' }, { name: 'minScore', type: 'uint8' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'isExpired', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'wallet', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'requestAttestation', type: 'function', stateMutability: 'payable',
    inputs:  [{ name: 'wallet', type: 'address' }],
    outputs: [],
  },
  { name: 'AttestationRequested', type: 'event', inputs: [{ name: 'wallet', type: 'address', indexed: true }, { name: 'requestId', type: 'uint256', indexed: true }] },
  { name: 'AttestationStored',    type: 'event', inputs: [{ name: 'wallet', type: 'address', indexed: true }, { name: 'score', type: 'uint8', indexed: false }, { name: 'txCount', type: 'uint256', indexed: false }, { name: 'balanceWei', type: 'uint256', indexed: false }] },
  { name: 'AttestationFailed',    type: 'event', inputs: [{ name: 'wallet', type: 'address', indexed: true }, { name: 'status', type: 'uint8', indexed: false }] },
] as const

export const LAUNCH_POOL_ABI = [
  { name: 'nextPoolId',      type: 'function', stateMutability: 'view', inputs: [],                                                                   outputs: [{ type: 'uint256' }] },
  { name: 'sybilRegistry',  type: 'function', stateMutability: 'view', inputs: [],                                                                    outputs: [{ type: 'address' }] },
  {
    name: 'pools', type: 'function', stateMutability: 'view',
    inputs:  [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'projectToken',  type: 'address' }, { name: 'tokenPrice',   type: 'uint256' },
      { name: 'hardCap',       type: 'uint256' }, { name: 'softCap',      type: 'uint256' },
      { name: 'perWalletCap',  type: 'uint256' }, { name: 'totalTokens',  type: 'uint256' },
      { name: 'startTime',     type: 'uint256' }, { name: 'endTime',      type: 'uint256' },
      { name: 'totalRaised',   type: 'uint256' }, { name: 'minSybilScore', type: 'uint8'  },
      { name: 'finalized',     type: 'bool'    }, { name: 'softCapMet',   type: 'bool'    },
      { name: 'finalizedAt',   type: 'uint256' }, { name: 'buyerCliff',   type: 'uint256' },
      { name: 'buyerVest',     type: 'uint256' }, { name: 'usesTreasury', type: 'bool'    },
      { name: 'treasuryReleased', type: 'uint256' },
    ],
  },
  { name: 'poolOwner',     type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }],                                        outputs: [{ type: 'address' }] },
  { name: 'contributions', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }],         outputs: [{ type: 'uint256' }] },
  { name: 'isActive',      type: 'function', stateMutability: 'view', inputs: [{ name: 'poolId', type: 'uint256' }],                                  outputs: [{ type: 'bool'    }] },
  {
    name: 'getClaimableTokens', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'uint256' }, { name: 'participant', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'createPool', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'p', type: 'tuple',
        components: [
          { name: 'projectToken',  type: 'address' }, { name: 'tokenPrice',    type: 'uint256' },
          { name: 'hardCap',       type: 'uint256' }, { name: 'softCap',       type: 'uint256' },
          { name: 'perWalletCap',  type: 'uint256' }, { name: 'totalTokens',   type: 'uint256' },
          { name: 'startTime',     type: 'uint256' }, { name: 'endTime',       type: 'uint256' },
          { name: 'minSybilScore', type: 'uint8'   }, { name: 'buyerCliff',    type: 'uint256' },
          { name: 'buyerVest',     type: 'uint256' },
        ],
      },
      {
        name: 'milestones', type: 'tuple[]',
        components: [
          { name: 'description',    type: 'string'  }, { name: 'evidenceDomain', type: 'string'  },
          { name: 'releaseBps',     type: 'uint16'  }, { name: 'deadline',       type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'poolId', type: 'uint256' }],
  },
  { name: 'participate',       type: 'function', stateMutability: 'payable',     inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [] },
  { name: 'finalize',          type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [] },
  { name: 'claimTokens',       type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [] },
  { name: 'refund',            type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [] },
  { name: 'clawback',          type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [] },
  { name: 'claimFundMilestone',type: 'function', stateMutability: 'payable',     inputs: [{ name: 'poolId', type: 'uint256' }, { name: 'milestoneIndex', type: 'uint256' }], outputs: [] },
  { name: 'getVestedClaimable',type: 'function', stateMutability: 'view',        inputs: [{ name: 'poolId', type: 'uint256' }, { name: 'participant', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getClawbackable',   type: 'function', stateMutability: 'view',        inputs: [{ name: 'poolId', type: 'uint256' }, { name: 'participant', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'getFundMilestoneCount', type: 'function', stateMutability: 'view',    inputs: [{ name: 'poolId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  {
    name: 'getFundMilestones', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'poolId', type: 'uint256' }],
    outputs: [{ type: 'tuple[]', components: [
      { name: 'description', type: 'string' }, { name: 'evidenceDomain', type: 'string' },
      { name: 'releaseBps', type: 'uint16' }, { name: 'deadline', type: 'uint256' }, { name: 'status', type: 'uint8' },
    ]}],
  },
  { name: 'PoolCreated',   type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'owner', type: 'address', indexed: true }, { name: 'projectToken', type: 'address', indexed: true }, { name: 'hardCap', type: 'uint256', indexed: false }, { name: 'softCap', type: 'uint256', indexed: false }] },
  { name: 'Participated',  type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'participant', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'totalRaised', type: 'uint256', indexed: false }] },
  { name: 'PoolFinalized', type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'softCapMet', type: 'bool', indexed: false }, { name: 'totalRaised', type: 'uint256', indexed: false }] },
  { name: 'TokensClaimed', type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'participant', type: 'address', indexed: true }, { name: 'tokenAmount', type: 'uint256', indexed: false }] },
  { name: 'Refunded',      type: 'event', inputs: [{ name: 'poolId', type: 'uint256', indexed: true }, { name: 'participant', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
] as const

export const VESTING_VAULT_ABI = [
  { name: 'TOTAL_DEPOSIT',   type: 'function', stateMutability: 'view', inputs: [],                                          outputs: [{ type: 'uint256' }] },
  { name: 'nextScheduleId',  type: 'function', stateMutability: 'view', inputs: [],                                          outputs: [{ type: 'uint256' }] },
  { name: 'PLATFORM',        type: 'function', stateMutability: 'view', inputs: [],                                          outputs: [{ type: 'address' }] },
  {
    name: 'schedules', type: 'function', stateMutability: 'view',
    inputs:  [{ name: '', type: 'uint256' }],
    outputs: [{ name: 'beneficiary', type: 'address' }, { name: 'token', type: 'address' }, { name: 'totalAmount', type: 'uint256' }, { name: 'unlockedAmount', type: 'uint256' }],
  },
  {
    name: 'getMilestones', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'scheduleId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple[]', components: [
      { name: 'description', type: 'string' }, { name: 'evidenceUrl', type: 'string' },
      { name: 'unlockAmount', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ]}],
  },
  { name: 'getMilestoneCount', type: 'function', stateMutability: 'view', inputs: [{ name: 'scheduleId', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
  {
    name: 'createSchedule', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' }, { name: 'totalAmount', type: 'uint256' }, { name: 'beneficiary', type: 'address' },
      { name: 'milestoneInputs', type: 'tuple[]', components: [
        { name: 'description', type: 'string' }, { name: 'evidenceUrl', type: 'string' },
        { name: 'unlockAmount', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
      ]},
    ],
    outputs: [{ name: 'scheduleId', type: 'uint256' }],
  },
  { name: 'claimMilestone',    type: 'function', stateMutability: 'payable',    inputs: [{ name: 'scheduleId', type: 'uint256' }, { name: 'milestoneIndex', type: 'uint256' }], outputs: [] },
  { name: 'resetMilestone',    type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'scheduleId', type: 'uint256' }, { name: 'milestoneIndex', type: 'uint256' }], outputs: [] },
  { name: 'emergencyWithdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'scheduleId', type: 'uint256' }],                                               outputs: [] },
  { name: 'ScheduleCreated',   type: 'event', inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: true }, { name: 'totalAmount', type: 'uint256', indexed: false }, { name: 'milestoneCount', type: 'uint256', indexed: false }] },
  { name: 'MilestoneClaimed',  type: 'event', inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'milestoneIndex', type: 'uint256', indexed: true }, { name: 'parseRequestId', type: 'uint256', indexed: true }] },
  { name: 'MilestonePassed',   type: 'event', inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'milestoneIndex', type: 'uint256', indexed: true }, { name: 'unlockedAmount', type: 'uint256', indexed: false }] },
  { name: 'MilestoneFailed',   type: 'event', inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'milestoneIndex', type: 'uint256', indexed: true }] },
  { name: 'MilestoneReset',    type: 'event', inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'milestoneIndex', type: 'uint256', indexed: true }] },
  { name: 'EmergencyWithdrawal', type: 'event', inputs: [{ name: 'scheduleId', type: 'uint256', indexed: true }, { name: 'beneficiary', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { name: 'TokensUnlocked',    type: 'event', inputs: [{ name: 'beneficiary', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
] as const

export const ERC20_ABI = [
  { name: 'name',       type: 'function', stateMutability: 'view',        inputs: [],                                                                            outputs: [{ type: 'string'  }] },
  { name: 'symbol',     type: 'function', stateMutability: 'view',        inputs: [],                                                                            outputs: [{ type: 'string'  }] },
  { name: 'decimals',   type: 'function', stateMutability: 'view',        inputs: [],                                                                            outputs: [{ type: 'uint8'   }] },
  { name: 'totalSupply',type: 'function', stateMutability: 'view',        inputs: [],                                                                            outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf',  type: 'function', stateMutability: 'view',        inputs: [{ name: '', type: 'address' }],                                               outputs: [{ type: 'uint256' }] },
  { name: 'allowance',  type: 'function', stateMutability: 'view',        inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],    outputs: [{ type: 'uint256' }] },
  { name: 'approve',    type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],  outputs: [{ type: 'bool'    }] },
  { name: 'mint',       type: 'function', stateMutability: 'nonpayable',  inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],        outputs: []                    },
] as const
