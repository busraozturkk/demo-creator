import { DEFAULTS } from './constants';

const IBAN_CHECKSUM_BASE = 98;
const IBAN_MODULO = 97;
const MOD_BLOCK_SIZE = 9;
const CHAR_CODE_A = 65;
const CHAR_CODE_Z = 90;
const LETTER_TO_NUMBER_OFFSET = 55;

/**
 * Calculate IBAN checksum using modulo 97
 */
function mod97(iban: string): number {
  let remainder = iban;

  while (remainder.length > 2) {
    const block = remainder.slice(0, MOD_BLOCK_SIZE);
    remainder = (parseInt(block, 10) % IBAN_MODULO) + remainder.slice(block.length);
  }

  return parseInt(remainder, 10) % IBAN_MODULO;
}

/**
 * Calculate IBAN check digits
 */
function calculateCheckDigits(countryCode: string, bban: string): string {
  const rearranged = bban + countryCode + '00';

  // Convert letters to numbers (A=10, B=11, ..., Z=35)
  const numericString = rearranged
    .split('')
    .map(char => {
      const code = char.charCodeAt(0);
      if (code >= CHAR_CODE_A && code <= CHAR_CODE_Z) {
        return (code - LETTER_TO_NUMBER_OFFSET).toString();
      }
      return char;
    })
    .join('');

  const remainder = mod97(numericString);
  const checkDigits = IBAN_CHECKSUM_BASE - remainder;

  return checkDigits.toString().padStart(2, '0');
}

/**
 * Generate a valid German IBAN
 * Format: DE + 2 check digits + 18 digits (8 bank code + 10 account)
 */
export function generateGermanIBAN(accountNumber: string): string {
  const bankCode = DEFAULTS.IBAN_BANK_CODE_DE;
  const paddedAccount = accountNumber.padStart(10, '0');
  const bban = bankCode + paddedAccount;

  const checkDigits = calculateCheckDigits('DE', bban);

  return `DE${checkDigits}${bban}`;
}

/**
 * Generate a valid British IBAN
 * Format: GB + 2 check digits + 4 bank code + 6 sort code + 8 account
 */
export function generateBritishIBAN(accountNumber: string): string {
  const bankCode = DEFAULTS.IBAN_BANK_CODE_GB;
  const sortCode = DEFAULTS.IBAN_SORT_CODE_GB;
  const paddedAccount = accountNumber.padStart(8, '0');
  const bban = bankCode + sortCode + paddedAccount;

  const checkDigits = calculateCheckDigits('GB', bban);

  return `GB${checkDigits}${bban}`;
}

// Test
if (require.main === module) {
  console.log('Testing IBAN generation:');
  console.log('German IBANs:');
  for (let i = 0; i < 15; i++) {
    const iban = generateGermanIBAN(`532013${i.toString().padStart(3, '0')}`);
    console.log(`  ${i + 1}: ${iban}`);
  }

  console.log('\nBritish IBANs:');
  for (let i = 0; i < 15; i++) {
    const iban = generateBritishIBAN(`987654${i.toString().padStart(2, '0')}`);
    console.log(`  ${i + 1}: ${iban}`);
  }
}
