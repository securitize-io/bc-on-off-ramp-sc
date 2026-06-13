// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.22;

/**
 * @title IGroveBasin
 * @notice Minimal interface for interacting with the Grove Basin protocol.
 * @dev This interface exposes only the functions required by this project to
 *      interact with the Grove Basin smart contract. It is not intended to be
 *      a complete representation of the protocol's public API.
 *
 *      For comprehensive documentation, supported operations, and the latest
 *      contract interfaces, refer to the official Grove Basin repository:
 *      https://github.com/grove-labs/grove-basin
 */
interface IGroveBasin {
    error SwapSizeExceeded();
    error ZeroReceiver();
    error ZeroAmountIn();
    error AmountOutTooLow();

    /**
 *  @dev   Emitted when an asset is swapped in the GroveBasin.
     *  @param assetIn       Address of the asset swapped in.
     *  @param assetOut      Address of the asset swapped out.
     *  @param sender        Address of the sender of the swap.
     *  @param receiver      Address of the receiver of the swap.
     *  @param amountIn      Amount of the asset swapped in.
     *  @param amountOut     Amount of the asset swapped out.
     *  @param referralCode  Referral code for the swap.
     */
    event Swap(
        address indexed assetIn,
        address indexed assetOut,
        address sender,
        address indexed receiver,
        uint256 amountIn,
        uint256 amountOut,
        uint256 referralCode
    );


    /**
     *  @dev    Swaps a specified amount of assetIn for assetOut in the GroveBasin. The amount swapped is
     *          converted based on the current value of the two assets used in the swap. This
     *          function will revert if there is not enough balance in the GroveBasin to facilitate the
     *          swap. Both assets must be supported in the GroveBasin in order to succeed.
     *  @param  assetIn      Address of the ERC-20 asset to swap in.
     *  @param  assetOut     Address of the ERC-20 asset to swap out.
     *  @param  amountIn     Amount of the asset to swap in.
     *  @param  minAmountOut Minimum amount of the asset to receive.
     *  @param  receiver     Address of the receiver of the swapped assets.
     *  @param  referralCode Referral code for the swap.
     *  @return amountOut    Resulting amount of the asset that will be received in the swap.
     */
    function swapExactIn(
        address assetIn,
        address assetOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address receiver,
        uint256 referralCode
    ) external returns (uint256 amountOut);

    /**
     * @dev    View function that returns the exact amount of assetOut that would be received for a
     *         given amount of assetIn in a swap. The amount returned is converted based on the
     *         current value of the two assets used in the swap.
     * @param  assetIn   Address of the ERC-20 asset to swap in.
     * @param  assetOut  Address of the ERC-20 asset to swap out.
     * @param  amountIn  Amount of the asset to swap in.
     * @return amountOut Amount of the asset that will be received in the swap.
     */
    function previewSwapExactIn(address assetIn, address assetOut, uint256 amountIn)
    external view returns (uint256 amountOut);

    /**
     * @notice Wallet that custodies the liquidity used to settle swaps.
     * @dev    Grove Basin transfers the swapped-out asset from this address, so it must hold a
     *         sufficient balance for the swap to succeed. Read fresh on every call because this
     *         is a third-party contract and the value may change at any time.
     * @return The pocket address holding the swappable liquidity.
     */
    function pocket() external view returns (address);
}