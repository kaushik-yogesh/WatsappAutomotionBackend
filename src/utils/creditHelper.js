const CreditTransaction = require('../models/CreditTransaction');

/**
 * Log a credit transaction (deduction, addition, or refund) in the database.
 * @param {Object} params
 * @param {string} params.userId - The ID of the user
 * @param {'deduction'|'addition'|'refund'} params.type - Transaction type
 * @param {number} params.amount - The absolute amount of credits (will be stored as positive number)
 * @param {string} params.description - The reason or detail for this transaction
 * @param {Object} [params.metadata] - Extra metadata about the transaction
 */
exports.logTransaction = async ({ userId, type, amount, description, metadata }) => {
  try {
    await CreditTransaction.create({
      user: userId,
      type,
      amount,
      description,
      metadata,
    });
  } catch (err) {
    console.error('Failed to log credit transaction:', err);
  }
};
