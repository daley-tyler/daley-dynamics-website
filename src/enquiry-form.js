const ENDPOINT = '/api/enquiries';
const REQUEST_TIMEOUT_MS = 15_000;

const fieldNameMap = {
  currentProcess: 'current-process',
  desiredResult: 'desired-result',
};

function formValue(formData, name) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

export function buildEnquiryPayload(enquiryForm) {
  const formData = new FormData(enquiryForm);
  return {
    name: formValue(formData, 'name'),
    company: formValue(formData, 'company'),
    email: formValue(formData, 'email'),
    phone: formValue(formData, 'phone'),
    help: formData.getAll('help').filter((value) => typeof value === 'string'),
    problem: formValue(formData, 'problem'),
    currentProcess: formValue(formData, 'current-process'),
    desiredResult: formValue(formData, 'desired-result'),
    stage: formValue(formData, 'stage'),
    website: formValue(formData, 'website'),
    formStartedAt: Number(
      enquiryForm.dataset.formStartedAt || formValue(formData, 'formStartedAt'),
    ),
  };
}

function clearFieldErrors(enquiryForm) {
  enquiryForm.querySelectorAll('[data-field-error]').forEach((error) => error.remove());
  enquiryForm.querySelectorAll('[aria-invalid="true"]').forEach((control) => {
    control.removeAttribute('aria-invalid');
    const describedBy = (control.getAttribute('aria-describedby') || '')
      .split(' ')
      .filter((id) => id && !id.startsWith('enquiry-error-'));
    if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
    else control.removeAttribute('aria-describedby');
  });
}

function showFieldErrors(enquiryForm, fieldErrors) {
  let firstInvalid;
  Object.entries(fieldErrors || {}).forEach(([field, message]) => {
    if (field === 'form') return;
    const name = fieldNameMap[field] || field;
    const controls = [...enquiryForm.querySelectorAll(`[name="${CSS.escape(name)}"]`)];
    if (!controls.length) return;

    const error = document.createElement('p');
    const errorId = `enquiry-error-${name.replace(/[^a-z0-9-]/gi, '-')}`;
    error.id = errorId;
    error.className = 'field-error';
    error.dataset.fieldError = '';
    error.textContent = message;

    controls.forEach((control) => {
      control.setAttribute('aria-invalid', 'true');
      const describedBy = new Set(
        (control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean),
      );
      describedBy.add(errorId);
      control.setAttribute('aria-describedby', [...describedBy].join(' '));
    });

    if (controls.length > 1) controls[0].closest('fieldset')?.append(error);
    else controls[0].insertAdjacentElement('afterend', error);
    firstInvalid ??= controls[0];
  });
  firstInvalid?.focus();
}

function setStatus(enquiryForm, type, message, { focus = true } = {}) {
  const status = enquiryForm.querySelector('[data-form-status]');
  if (!status) return;
  status.dataset.status = type;
  status.textContent = message;
  if (focus) status.focus();
}

export function initEnquiryForm(enquiryForm) {
  if (!enquiryForm) return;

  const requestedHelp = new URLSearchParams(location.search)
    .get('help')
    ?.split(',')
    .filter(Boolean);

  requestedHelp?.forEach((value) => {
    const option = enquiryForm.querySelector(`input[name="help"][value="${CSS.escape(value)}"]`);
    if (option) option.checked = true;
  });

  const startedAt = enquiryForm.querySelector('input[name="formStartedAt"]');
  const submitButton = enquiryForm.querySelector('[data-enquiry-submit]');
  const submitLabel = submitButton?.querySelector('[data-submit-label]');
  enquiryForm.dataset.formStartedAt = String(Date.now());
  if (startedAt) startedAt.value = enquiryForm.dataset.formStartedAt;
  if (submitButton) submitButton.disabled = false;

  enquiryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearFieldErrors(enquiryForm);
    if (!enquiryForm.reportValidity() || !submitButton) return;

    submitButton.disabled = true;
    if (submitLabel) submitLabel.textContent = 'Sending…';
    enquiryForm.dataset.state = 'submitting';
    enquiryForm.setAttribute('aria-busy', 'true');
    setStatus(enquiryForm, 'progress', 'Sending your enquiry…', { focus: false });

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let delivered = false;

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(buildEnquiryPayload(enquiryForm)),
        signal: controller.signal,
      });
      const result = await response.json().catch(() => null);

      if (response.ok && result?.ok) {
        delivered = true;
        enquiryForm.dataset.state = 'success';
        enquiryForm.dataset.submitted = 'true';
        if (submitLabel) submitLabel.textContent = 'Enquiry sent';
        setStatus(
          enquiryForm,
          'success',
          'Thanks — your enquiry has been sent. Tyler will review what you shared and reply using the contact details above.',
        );
        return;
      }

      if (response.status === 422 && result?.fieldErrors) {
        setStatus(enquiryForm, 'error', result.message);
        showFieldErrors(enquiryForm, result.fieldErrors);
      } else {
        setStatus(
          enquiryForm,
          'error',
          result?.message || 'Your enquiry could not be sent right now. Please try again.',
        );
      }
    } catch {
      setStatus(
        enquiryForm,
        'error',
        'Your enquiry could not be sent right now. Please check your connection and try again.',
      );
    } finally {
      window.clearTimeout(timeout);
      enquiryForm.removeAttribute('aria-busy');
      if (!delivered) {
        delete enquiryForm.dataset.state;
        submitButton.disabled = false;
        if (submitLabel) submitLabel.textContent = 'Send project enquiry';
      }
    }
  });

  enquiryForm.addEventListener('input', (event) => {
    const control = event.target.closest('[aria-invalid="true"]');
    if (!control) return;
    const errorId = (control.getAttribute('aria-describedby') || '')
      .split(' ')
      .find((id) => id.startsWith('enquiry-error-'));
    if (!errorId) return;
    document.getElementById(errorId)?.remove();
    enquiryForm.querySelectorAll(`[aria-describedby~="${CSS.escape(errorId)}"]`).forEach((item) => {
      item.removeAttribute('aria-invalid');
      const describedBy = (item.getAttribute('aria-describedby') || '')
        .split(' ')
        .filter((id) => id && id !== errorId);
      if (describedBy.length) item.setAttribute('aria-describedby', describedBy.join(' '));
      else item.removeAttribute('aria-describedby');
    });
  });
}
