import { task, types } from 'hardhat/config';
import { SecuritizeOffRamp } from '../../typechain-types';

task('update-countries-restriction', 'Update restriction status for multiple countries at once')
    .addParam('redemption', 'Address of the SecuritizeOffRamp contract', undefined, types.string)
    .addParam(
        'countries',
        'Comma-separated list of country codes (2-3 uppercase characters each)',
        undefined,
        types.string,
    )
    .addParam('restricted', 'Whether the countries should be restricted (true/false)', undefined, types.boolean)
    .setAction(async (args, hre) => {
        // Parse and validate country codes
        const countries = args.countries.split(',').map((country: string) => country.trim());

        for (const country of countries) {
            if (![2, 3].includes(country.length) || !country.match(/^[A-Z]+$/)) {
                throw new Error(`Invalid country code: ${country}. Must be 2-3 uppercase characters`);
            }
        }

        console.log(
            `Updating restriction for countries [${countries.join(', ')}] to ${args.restricted ? 'RESTRICTED' : 'NOT RESTRICTED'}...`,
        );

        // Get signer
        const [signer] = await hre.ethers.getSigners();
        console.log(`Using signer: ${signer.address}`);

        // Connect to the redemption contract
        const contract = await hre.ethers.getContractAt('SecuritizeOffRamp', args.redemption, signer);
        const redemption = contract as unknown as SecuritizeOffRamp;

        if (signer.address !== (await redemption.owner())) {
            throw new Error('Signer is not the owner of the contract');
        }

        // Log current status for each country
        for (const country of countries) {
            const currentStatus = await redemption.restrictedCountries(country);
            console.log(
                `Current restriction status for ${country}: ${currentStatus ? 'RESTRICTED' : 'NOT RESTRICTED'}`,
            );
        }

        // Update countries restriction
        const tx = await redemption.updateCountriesRestriction(countries, args.restricted);
        await tx.wait();

        // Verify the statuses were updated
        console.log('\nUpdated restriction statuses:');
        for (const country of countries) {
            const newStatus = await redemption.restrictedCountries(country);
            console.log(`${country}: ${newStatus ? 'RESTRICTED' : 'NOT RESTRICTED'}`);
        }

        return {
            status: 'success',
            countries: countries.map((country: string) => ({
                country,
                restricted: args.restricted,
            })),
        };
    });
