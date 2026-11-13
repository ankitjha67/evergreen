"""Billing service — uses Stripe Python SDK for subscription management."""
import os
import stripe

stripe.api_key = os.environ["STRIPE_SECRET_KEY"]


def get_upcoming_invoice(customer_id: str):
    """Preview what the customer's next invoice will look like."""
    upcoming = stripe.Invoice.upcoming(customer=customer_id)
    return {
        "amount_due": upcoming.amount_due,
        "currency": upcoming.currency,
        "lines": upcoming.lines.data,
    }


def get_subscription_renewal(subscription_id: str):
    """Return when a subscription renews."""
    sub = stripe.Subscription.retrieve(subscription_id)
    return {
        "renews_at": sub.current_period_end,
        "started_at": sub.current_period_start,
        "status": sub.status,
    }


def create_charge(amount: int, currency: str, source: str):
    """Create a one-time charge."""
    charge = stripe.Charge.create(
        amount=amount,
        currency=currency,
        source=source,
    )
    return charge
