// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.22;

/// @notice Adapter-specific interface for EthenaPSMAdapter — errors, events and functions
///         that have no counterpart in IGroveBasin.
interface IPSMAdapter {
    /**********************************************************************************************/
    /*** Errors                                                                                 ***/
    /**********************************************************************************************/

    // --- PSM wiring ---
    error ZeroPsm();
    error PsmNotAContract();
    error PsmAssetMismatch();
    error PsmAssetDecimalsMismatch();
    error PsmCollateralNotConfigured();
    error PsmSwapDisabled();
    error PsmCollateralInactive();
    error BenefactorNotActive();

    // --- Swap validation ---
    error AmountExceedsUint128();
    error AmountInBelowPsmMinimum();
    error ZeroAmountOut();
    error UnexpectedPsmOutput(uint256 expected, uint256 actual);
    error ResidualApproval();
    error ReceiverNotApproved();
    error CallerNotApproved();

    /**********************************************************************************************/
    /*** Events                                                                                 ***/
    /**********************************************************************************************/

    /**
     *  @dev   Emitted when the PSM contract is rotated.
     *  @param oldPsm Address of the previous PSM.
     *  @param newPsm Address of the new PSM.
     */
    event PsmSet(address indexed oldPsm, address indexed newPsm);

    event OnProviderSet(address indexed oldOnProvider, address indexed newOnProvider);
    event OffProviderSet(address indexed oldOffProvider, address indexed newOffProvider);

    /**
     *  @dev        Emitted when the OnRamp address is updated.
     *  @param oldOnRamp Previous OnRamp address.
     *  @param newOnRamp New OnRamp address.
     */
    event OnRampSet(address indexed oldOnRamp, address indexed newOnRamp);

    /**
     *  @dev         Emitted when the OffRamp address is updated.
     *  @param oldOffRamp Previous OffRamp address.
     *  @param newOffRamp New OffRamp address.
     */
    event OffRampSet(address indexed oldOffRamp, address indexed newOffRamp);

    /**
     *  @dev                  Emitted when accumulated ramp fees are swept to PSM custodians.
     *  @param collateral      Address of the collateral token (USDC).
     *  @param collateralDest  Destination for collateral — PSM collateral receive custodian.
     *  @param collateralAmount Amount of collateral swept.
     *  @param credit          Address of the credit token (BUIDL).
     *  @param creditDest      Destination for credit — PSM asset receive custodian.
     *  @param creditAmount    Amount of credit swept.
     */
    event Swept(
        address indexed collateral,
        address collateralDest,
        uint256 collateralAmount,
        address indexed credit,
        address creditDest,
        uint256 creditAmount
    );

    /**
     *  @dev    Emitted when tokens are rescued from the adapter to an arbitrary address.
     *  @param token   Address of the rescued token.
     *  @param to      Recipient address.
     *  @param amount  Amount rescued.
     */
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    /**********************************************************************************************/
    /*** Functions                                                                              ***/
    /**********************************************************************************************/

    /**
     *  @dev    Returns a best-effort upper bound on the BUIDL amount available for buy-direction
     *          swaps. Accounts for PSM rate limits (epoch and period caps for global, per-collateral
     *          and per-benefactor) and the send-custodian's inventory and allowance.
     *          Returns 0 on any blocking condition: PSM swap disabled (`isSwapEnabled() == false`),
     *          inactive or unconfigured collateral, or inactive benefactor.
     *          Note: PSM has no `Pausable`; the liveness control is `isSwapEnabled`.
     *
     *  @return Upper bound on the deliverable BUIDL amount, in BUIDL's native decimals.
     */
    function availableAsset() external view returns (uint256);
}
