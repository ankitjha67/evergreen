// Package billing handles Stripe webhook events.
package billing

import (
	"fmt"
	"os"

	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/customer"
	"github.com/stripe/stripe-go/v81/invoice"
)

func init() {
	stripe.Key = os.Getenv("STRIPE_SECRET_KEY")
}

func HandleInvoicePaymentSucceeded(event *stripe.Event) error {
	inv := event.Data.Object
	customerID := inv["customer"].(string)

	upcoming, err := invoice.GetNext(&stripe.InvoiceUpcomingParams{
		Customer: stripe.String(customerID),
	})
	if err != nil {
		return fmt.Errorf("failed to get upcoming: %w", err)
	}

	fmt.Printf("Paid. Next invoice: %d\n", upcoming.AmountDue)
	return nil
}

func HandleSubscriptionUpdated(event *stripe.Event) error {
	subData := event.Data.Object
	sub := subData["object"].(*stripe.Subscription)
	periodEnd := sub.CurrentPeriodEnd

	cust, err := customer.Get(subData["customer"].(string), nil)
	if err != nil {
		return err
	}
	fmt.Printf("Subscription for %s renews at %d\n", cust.Email, periodEnd)
	return nil
}
