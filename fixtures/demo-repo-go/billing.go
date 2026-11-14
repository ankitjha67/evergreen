// Package billing uses the Stripe Go SDK for subscription management.
package billing

import (
	"fmt"
	"os"

	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/charge"
	"github.com/stripe/stripe-go/v81/invoice"
	"github.com/stripe/stripe-go/v81/sub"
)

func init() {
	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")
}

func GetUpcomingInvoice(customerID string) (*stripe.Invoice, error) {
	upcoming, err := invoice.GetNext(&stripe.InvoiceUpcomingParams{
		Customer: stripe.String(customerID),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get upcoming invoice: %w", err)
	}
	return upcoming, nil
}

func GetSubscriptionRenewal(subscriptionID string) (int64, int64, error) {
	s, err := sub.Get(subscriptionID, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to get subscription: %w", err)
	}
	return s.CurrentPeriodEnd, s.CurrentPeriodStart, nil
}

func CreateCharge(amount int64, currency, source string) (*stripe.Charge, error) {
	c, err := charge.New(&stripe.ChargeParams{
		Amount:   stripe.Int64(amount),
		Currency: stripe.String(currency),
		Source:   &stripe.PaymentSourceSourceParams{Token: stripe.String(source)},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create charge: %w", err)
	}
	return c, nil
}
