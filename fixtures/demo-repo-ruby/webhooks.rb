# Webhook handler — processes Stripe events.
require 'stripe'

Stripe.api_key = 'sk_test_dummy'

def handle_invoice_payment_succeeded(event)
  invoice = event['data']['object']
  customer_id = invoice['customer']

  # Check upcoming charges for this customer
  upcoming = Stripe::Invoice.upcoming(customer: customer_id)
  next_amount = upcoming.amount_due

  puts "Paid: #{invoice['amount_paid']}. Next invoice: #{next_amount}"
  { next_amount: next_amount }
end

def handle_subscription_updated(event)
  subscription = event['data']['object']
  period_end = subscription.current_period_end
  customer = Stripe::Customer.retrieve(subscription['customer'])
  puts "Subscription for #{customer.email} renews at #{period_end}"
end
