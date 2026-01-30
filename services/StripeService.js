const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const StripeService = {
  createCheckoutSession: ({ items, successUrl, cancelUrl, metadata }) => {
    const line_items = (items || []).map((item) => ({
      price_data: {
        currency: 'sgd',
        product_data: { name: item.productName || 'Item' },
        unit_amount: Math.max(1, Math.round(Number(item.unit_price_after_discount || 0) * 100))
      },
      quantity: Number(item.quantity || 1)
    }));

    return stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: metadata || {}
    });
  },

  retrieveCheckoutSession: (sessionId) => {
    return stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
  },

  refundPaymentIntent: (paymentIntentId, amountCents) => {
    const payload = { payment_intent: paymentIntentId };
    if (amountCents && Number(amountCents) > 0) {
      payload.amount = Number(amountCents);
    }
    return stripe.refunds.create(payload);
  }
};

module.exports = StripeService;
