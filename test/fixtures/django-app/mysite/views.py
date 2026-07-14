"""Views for the sample site."""
from django.http import HttpResponse


def index(request):
    """Render the landing page."""
    return HttpResponse("hello")


class HealthCheck:
    """Report service liveness."""

    def status(self):
        """Return the liveness flag."""
        return True
