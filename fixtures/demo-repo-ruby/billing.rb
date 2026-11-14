# Billing service — uses Stripe Ruby SDK for subscription management.
require 'stripe'

Stripe.api_key = ENV['STRIPE_SECRET_KEY']

def get_upcoming_invoice(customer_id)
  upcoming = Stripe::Invoice.upcoming(customer: customer_id)
  {
    amount_due: upcoming.amount_due,
    currency: upcoming.currency,
    lines: upcoming.lines.data
  }
end

def get_subscription_renewal(subscription_id)
  sub = Stripe::Subscription.retrieve(subscription_id)
  {
    renews_at: sub.current_period_end,
    started_at: sub.current_period_start,
    status: sub.status
  }
end

def create_charge(amount, currency, source)
  charge = Stripe::Charge.create(
    amount: amount,
    currency: currency,
    source: source
  )
  charge
end
