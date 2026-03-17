// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.22;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {NoncesUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/NoncesUpgradeable.sol";

/**
 * @title TIP712Verifier
 * @notice PoC contract to validate TIP-712 signature verification on TRON.
 *         Replicates the exact same domain, TXTYPE_HASH, and nonce logic
 *         used by PublicStockOnRamp so the off-chain signature structure is identical.
 */
contract TIP712Verifier is EIP712Upgradeable, NoncesUpgradeable {
    bytes32 private constant SWAP_TXTYPE_HASH =
        keccak256("Swap(uint256 liquidityAmount,uint256 minOutputAmount,uint256 nonce,uint256 deadline)");

    bytes32 private constant REDEEM_TXTYPE_HASH =
        keccak256("Redeem(uint256 assetAmount,uint256 minOutputAmount,uint256 nonce,uint256 deadline)");

    event SwapVerified(address indexed signer, bool valid);
    event RedeemVerified(address indexed signer, bool valid);

    function initialize() external initializer {
        __EIP712_init("PublicStockOnRamp", "1");
        __Nonces_init();
    }

    function initializeOffRamp() external initializer {
        __EIP712_init("PublicStockOffRamp", "1");
        __Nonces_init();
    }

    function verifySwap(
        uint256 _liquidityAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        uint256 _deadline,
        bytes calldata _signature
    ) external returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(SWAP_TXTYPE_HASH, _liquidityAmount, _minOutputAmount, _useNonce(_investorWallet), _deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, _signature);
        bool valid = recovered == _investorWallet;
        emit SwapVerified(recovered, valid);
        return valid;
    }

    function verifyRedeem(
        uint256 _assetAmount,
        uint256 _minOutputAmount,
        address _investorWallet,
        uint256 _deadline,
        bytes calldata _signature
    ) external returns (bool) {
        bytes32 structHash = keccak256(
            abi.encode(REDEEM_TXTYPE_HASH, _assetAmount, _minOutputAmount, _useNonce(_investorWallet), _deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, _signature);
        bool valid = recovered == _investorWallet;
        emit RedeemVerified(recovered, valid);
        return valid;
    }

    function getNonce(address account) external view returns (uint256) {
        return nonces(account);
    }
}
