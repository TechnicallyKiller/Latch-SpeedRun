// SPDX-License-Identifier: MIT
pragma solidity 0.8.31;

/// @title BondModule
/// @notice Self-contained accounting for (a) pull-over-push payouts and (b) locked bonds.
/// @dev Fund custody stays in the inheriting escrow (single custody point = simpler invariants
///      and a smaller trust surface than a separate fund-holding contract). This is the seam for
///      future ERC-4626 vaultization: `totalBondsLocked` are currently held as the escrow token
///      and accounted here; they can later be deposited into a vault and represented as shares
///      without changing the bond lifecycle (`_lockBond` / `_releaseBond`) used by the escrow.
abstract contract BondModule {
    /// @notice Amount each account may withdraw (settled proceeds, refunds, returned/slashed bonds).
    mapping(address account => uint256 amount) public withdrawable;

    /// @notice Sum of all `withdrawable` balances. Part of the solvency invariant.
    uint256 public totalWithdrawable;

    /// @notice Sum of all bonds currently locked across live jobs. Part of the solvency invariant.
    uint256 public totalBondsLocked;

    event Credited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    error NothingToWithdraw();

    /// @dev The public `withdraw()` entry point is exposed by the inheriting escrow so it can
    ///      apply its ReentrancyGuard; it calls {_withdraw}.

    /// @dev Credit a payout to an account's pull-payment balance.
    function _credit(address account, uint256 amount) internal {
        if (amount == 0) return;
        withdrawable[account] += amount;
        totalWithdrawable += amount;
        emit Credited(account, amount);
    }

    /// @dev Account for a newly locked bond (the token must already have been pulled in).
    function _lockBond(uint256 amount) internal {
        totalBondsLocked += amount;
    }

    /// @dev Account for a bond leaving the locked pool (it is then credited or slashed-and-credited).
    function _releaseBond(uint256 amount) internal {
        totalBondsLocked -= amount;
    }

    /// @dev Pull-payment withdrawal with checks-effects-interactions: zero the ledger before paying.
    function _withdraw(address account) internal returns (uint256 amount) {
        amount = withdrawable[account];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[account] = 0;
        totalWithdrawable -= amount;
        _payout(account, amount);
        emit Withdrawn(account, amount);
    }

    /// @dev Implemented by the escrow: move `amount` of the escrow token to `to`.
    function _payout(address to, uint256 amount) internal virtual;
}
