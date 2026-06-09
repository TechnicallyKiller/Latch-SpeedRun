// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MockUSDC
/// @notice LOCAL / ANVIL ONLY. A FiatTokenV2-equivalent test token implementing the EIP-3009
///         subset Latch relies on (transfer/receiveWithAuthorization). It mirrors Circle's USDC
///         EIP-712 domain (name "USD Coin", version "2") so signing code is identical to Fuji
///         mainnet/testnet. NEVER deploy this on a public network — on Fuji/C-Chain use the real
///         USDC addresses (Fuji 0x5425890298aed601595a70AB815c96711a31Bc65).
/// @dev 6 decimals, freely mintable for tests. Authorization nonces are arbitrary 32-byte values.
contract MockUSDC is ERC20, EIP712 {
    // EIP-3009 typehashes (identical to Circle's FiatTokenV2).
    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 private constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 private constant CANCEL_AUTHORIZATION_TYPEHASH =
        keccak256("CancelAuthorization(address authorizer,bytes32 nonce)");

    /// @notice authorizer => nonce => used.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthInvalidSignature();
    error AuthNotYetValid();
    error AuthExpired();
    error AuthAlreadyUsed();
    error CallerMustBePayee();

    constructor() ERC20("USD Coin", "USDC") EIP712("USD Coin", "2") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Test helper — mint freely.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _verifyAuth(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s);
        _transfer(from, to, value);
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _verifyAuth(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s);
        _transfer(from, to, value);
    }

    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
        if (authorizationState[authorizer][nonce]) revert AuthAlreadyUsed();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)));
        if (ECDSA.recover(digest, v, r, s) != authorizer) revert AuthInvalidSignature();
        authorizationState[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    function _verifyAuth(
        bytes32 typeHash,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private {
        if (block.timestamp <= validAfter) revert AuthNotYetValid();
        if (block.timestamp >= validBefore) revert AuthExpired();
        if (authorizationState[from][nonce]) revert AuthAlreadyUsed();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(typeHash, from, to, value, validAfter, validBefore, nonce))
        );
        if (ECDSA.recover(digest, v, r, s) != from) revert AuthInvalidSignature();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
    }
}
