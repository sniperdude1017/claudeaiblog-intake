const forms = document.querySelectorAll(".lead-form");

for (const form of forms) {
  const status = form.querySelector(".form-status");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "Submitting...";

    const formData = new FormData(form);
    const payload = {
      segment: form.dataset.segment,
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      zip: formData.get("zip"),
      ownsPhone: formData.get("ownsPhone") === "on",
      consent: formData.get("consent") === "on",
    };

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Submission failed");
      }

      form.reset();
      status.textContent = "Success, your request has been sent.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
}
