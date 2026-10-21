// Generated from Solidity source by contracts/scripts/build.mjs. Do not edit.
export const nullAuthRegistryAbi = [
  {
    "inputs": [
      {
        "internalType": "contract IPoseidon3",
        "name": "hasher",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "InvalidDependency",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidField",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PolicyAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TreeFull",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "policyCommitment",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "policyIndex",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "postAuthRoot",
        "type": "uint256"
      }
    ],
    "name": "PolicyRegistered",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "HASHER",
    "outputs": [
      {
        "internalType": "contract IPoseidon3",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "authRoot",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "root",
        "type": "uint256"
      }
    ],
    "name": "isKnownAuthRoot",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextPolicyIndex",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "policyCommitment",
        "type": "uint256"
      }
    ],
    "name": "register",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "registered",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const nullPoolAbi = [
  {
    "inputs": [
      {
        "internalType": "contract IERC20",
        "name": "asset",
        "type": "address"
      },
      {
        "internalType": "contract IPoseidon3",
        "name": "hasher",
        "type": "address"
      },
      {
        "internalType": "contract NullAuthRegistry",
        "name": "registry",
        "type": "address"
      },
      {
        "internalType": "contract IVerifier",
        "name": "shieldProofVerifier",
        "type": "address"
      },
      {
        "internalType": "contract IVerifier",
        "name": "distributionProofVerifier",
        "type": "address"
      },
      {
        "internalType": "contract IVerifier",
        "name": "claimProofVerifier",
        "type": "address"
      },
      {
        "internalType": "contract IVerifier",
        "name": "withdrawProofVerifier",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "ContextMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DistributionAlreadyInserted",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EnvelopeInvalid",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "IntentExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidDependency",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidField",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidField",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPublicInputs",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NullifierSpent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PolicyNotRegistered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProofInvalid",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrantCall",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "RootStale",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TreeFull",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "claimNullifier",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "noteCommitment",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "noteIndex",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "postNoteRoot",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "version",
        "type": "uint8"
      }
    ],
    "name": "AllocationConsumed",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "distributionCommitment",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "distributionIndex",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "postDistributionRoot",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "envelopeRoot",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "transportTag",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "version",
        "type": "uint8"
      }
    ],
    "name": "DistributionInserted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "transportTag",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint8",
        "name": "slot",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "version",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "ephemeralPubKey",
        "type": "bytes"
      },
      {
        "indexed": false,
        "internalType": "bytes1",
        "name": "viewTag",
        "type": "bytes1"
      },
      {
        "indexed": false,
        "internalType": "bytes",
        "name": "ciphertext",
        "type": "bytes"
      }
    ],
    "name": "EnvelopePublished",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "noteCommitment",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "noteIndex",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "postNoteRoot",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "noteType",
        "type": "uint8"
      }
    ],
    "name": "NoteInserted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "noteCommitment",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "noteIndex",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "Shielded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "noteNullifier",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "amount",
        "type": "uint64"
      }
    ],
    "name": "Withdrawn",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "ASSET",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "AUTH_REGISTRY",
    "outputs": [
      {
        "internalType": "contract NullAuthRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "CIPHERTEXT_BYTES",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "DISTRIBUTION_SLOTS",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "FIELD",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "HASHER",
    "outputs": [
      {
        "internalType": "contract IPoseidon3",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "PROTOCOL_VERSION",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "proof",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "inputs",
        "type": "bytes32[]"
      }
    ],
    "name": "claim",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimVerifier",
    "outputs": [
      {
        "internalType": "contract IVerifier",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "claimVerifierCodeHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "proof",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "inputs",
        "type": "bytes32[]"
      },
      {
        "components": [
          {
            "internalType": "bytes",
            "name": "ephemeralPubKey",
            "type": "bytes"
          },
          {
            "internalType": "bytes1",
            "name": "viewTag",
            "type": "bytes1"
          },
          {
            "internalType": "bytes",
            "name": "ciphertext",
            "type": "bytes"
          }
        ],
        "internalType": "struct NullPool.EnvelopeV1[8]",
        "name": "envelopes",
        "type": "tuple[8]"
      }
    ],
    "name": "createDistribution",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "createDistributionVerifier",
    "outputs": [
      {
        "internalType": "contract IVerifier",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "createDistributionVerifierCodeHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "distributionRoot",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "insertedDistribution",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "root",
        "type": "uint256"
      }
    ],
    "name": "isKnownDistributionRoot",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "root",
        "type": "uint256"
      }
    ],
    "name": "isKnownNoteRoot",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextDistributionIndex",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "nextNoteIndex",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "noteRoot",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "proof",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "inputs",
        "type": "bytes32[]"
      }
    ],
    "name": "shield",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "shieldVerifier",
    "outputs": [
      {
        "internalType": "contract IVerifier",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "shieldVerifierCodeHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "spentClaimNullifier",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "spentNoteNullifier",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "proof",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "inputs",
        "type": "bytes32[]"
      }
    ],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawVerifier",
    "outputs": [
      {
        "internalType": "contract IVerifier",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdrawVerifierCodeHash",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const erc20Abi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "decimals",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transfer",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      }
    ],
    "name": "transferFrom",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const verifierAbi = [
  {
    "inputs": [
      {
        "internalType": "bytes",
        "name": "proof",
        "type": "bytes"
      },
      {
        "internalType": "bytes32[]",
        "name": "publicInputs",
        "type": "bytes32[]"
      }
    ],
    "name": "verify",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
