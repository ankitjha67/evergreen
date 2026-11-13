"""Webhook handler — processes Stripe events."""
import stripe

stripe.api_key = "sk_test_dummy"


def handle_invoice_payment_succeeded(event):
    """Handle successful invoice payment."""
    invoice = event["data"]["object"]
    customer_id = invoice["customer"]

    # Check upcoming charges for this customer
    upcoming = stripe.Invoice.upcoming(customer=customer_id)
    next_amount = upcoming.amount_due

    print(f"Paid: {invoice['amount_paid']}. Next invoice: {next_amount}")
    return {"next_amount": next_amount}


def handle_subscription_updated(event):
    """Handle subscription update events."""
    subscription = event["data"]["object"]
    period_end = subscription.current_period_end
    customer = stripe.Customer.retrieve(subscription["customer"])
    print(f"Subscription for {customer.email} renews at {period_end}")
