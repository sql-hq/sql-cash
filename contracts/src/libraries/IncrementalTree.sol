// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IPoseidon3} from "../interfaces/IPoseidon3.sol";
import {Domains} from "./Domains.sol";

/// @notice Append-only depth-20 tree with a 128-root concurrency window.
/// The leaf/index history can always be reconstructed from public events.
library IncrementalTree {
    uint256 internal constant DEPTH = 20;
    uint256 internal constant CAPACITY = 1 << DEPTH;
    uint256 internal constant HISTORY = 128;
    uint256 internal constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    error TreeFull();
    error InvalidField();

    struct Tree {
        uint256 root;
        uint256 count;
        uint256 cursor;
        uint256[20] zeros;
        uint256[20] frontier;
        uint256[128] history;
        mapping(uint256 => uint256) rootOccurrences;
    }

    function initialize(Tree storage self, IPoseidon3 hasher) internal {
        uint256 zero;
        for (uint256 level; level < DEPTH; ++level) {
            self.zeros[level] = zero;
            zero = hasher.poseidon([Domains.MERKLE, zero, zero]);
        }
        self.root = zero;
        self.history[0] = zero;
        self.rootOccurrences[zero] = 1;
    }

    function insert(Tree storage self, IPoseidon3 hasher, uint256 leaf)
        internal returns (uint256 index, uint256 postRoot)
    {
        if (leaf == 0 || leaf >= FIELD) revert InvalidField();
        index = self.count;
        if (index == CAPACITY) revert TreeFull();
        uint256 position = index;
        postRoot = leaf;
        for (uint256 level; level < DEPTH; ++level) {
            if ((position & 1) == 0) {
                self.frontier[level] = postRoot;
                postRoot = hasher.poseidon([Domains.MERKLE, postRoot, self.zeros[level]]);
            } else {
                postRoot = hasher.poseidon([Domains.MERKLE, self.frontier[level], postRoot]);
            }
            position >>= 1;
        }
        self.count = index + 1;
        self.root = postRoot;
        uint256 cursor = (self.cursor + 1) % HISTORY;
        uint256 oldRoot = self.history[cursor];
        if (self.rootOccurrences[oldRoot] != 0) --self.rootOccurrences[oldRoot];
        self.history[cursor] = postRoot;
        ++self.rootOccurrences[postRoot];
        self.cursor = cursor;
    }

    function known(Tree storage self, uint256 root) internal view returns (bool) {
        return root != 0 && self.rootOccurrences[root] != 0;
    }
}
