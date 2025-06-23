# README

<img src="https://s3.us-east-2.amazonaws.com/securitize-public-files/securitize_logo+medium.png" alt="Securitize" width="200px"/>

# Securitize On/Off Ramp Protocol

### What is this repository for?

This protocol allows investor to subscribe/buy Securitize RWA

#### On Ramp
Securitize on ramp protocol allows investor to purchase digital securities.

### 1. `subscribe`

- **Description**: This is a permissioned method meant for verified investors.
- **Mechanism**:
    - Executed using a signed payload compliant with the [EIP-712](https://eips.ethereum.org/EIPS/eip-712) standard.
    - The platform backend generates and signs the request after validating all parameters.
- **Security**: Ensures access control via signature validation.

### 2. `swapFor`

- **Description**: Investors specify the amount of RWA tokens they wish to acquire.
- **Parameters**: Desired token amount and slippage tolerance.
- **Mechanism**:
    - The contract calculates the stablecoin cost based on the current NAV (Net Asset Value) rate.
    - Stablecoins are deducted from the investor’s balance accordingly.
- **Use Case**: Token-targeted purchases with slippage control.

### 3. `swap`

- **Description**: Investors specify the amount of stablecoins they want to use to purchase RWA tokens.
- **Parameters**: Stablecoin amount and slippage tolerance.
- **Mechanism**:
    - The contract computes the equivalent number of tokens to issue using the current NAV rate.
- **Use Case**: Budget-constrained purchases with token output calculated.

#### Off Ramp
Securitize off ramp protocol allows investor to redeem their digital securities by stable coins

Project was thought to have several implementations in order to supply stable coins (ILiquidityProvider).
Currently, we have just one implementation, in order to extend functionality in the future we must extend ILiquidityProvider interface

Securitize redemption protocol uses a NAV rate provider. The internal implementation of Securitize can be found here
[https://bitbucket.org/securitize_dev/bc-nav-provider-sc](https://bitbucket.org/securitize_dev/bc-nav-provider-sc)

- Version 0.0.1

### How do I get set up?

- Install dependencies

```sh
npm install
```

- Compile smart contracts

```sh
npm run compile
```

### Deploy
 TODO

### Test

```sh
npm test
```
