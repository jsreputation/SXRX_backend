# Tebra GetAvailability Solution

## Problem

The `GetAvailability` method is **NOT available** in Tebra SOAP 2.1 API. When called, it returns:
- Raw SOAP: `ActionNotSupported` error
- Soap Library: `client.GetAvailabilityAsync is not a function` error

## Solution

Since `GetAvailability` doesn't exist, we calculate availability using the following approach:

### 1. Use `GetAppointments` to Find Existing Appointments

Call `GetAppointments` with filters to get all existing appointments for a date range:
- Filter by `practiceId`
- Filter by `providerId` (optional)
- Filter by date range (`startDate` to `endDate`)

### 2. Generate Potential Time Slots

Based on business hours from `availability_settings` table:
- Get business hours for each day of the week
- Generate time slots at regular intervals (e.g., every 30 minutes)
- Only generate slots during enabled business hours

### 3. Filter Out Conflicting Slots

Compare potential slots with existing appointments:
- Remove any slot that overlaps with an existing appointment
- Keep only slots that are completely free

### 4. Apply Business Rules

Use `availabilityService.filterAvailability()` to apply:
- Blocked dates
- Blocked time slots
- Advance booking window limits
- Past date filtering

## Implementation

### Files Created

1. **`backend/src/services/availabilityCalculator.js`**
   - New service that implements the availability calculation logic
   - Uses `GetAppointments` to find existing appointments
   - Generates time slots based on business hours
   - Filters conflicts and applies business rules

### Files Modified

1. **`backend/src/services/tebraService.js`**
   - Updated `getAvailability()` to use `availabilityCalculator`
   - Maintains backward compatibility with existing code

2. **`backend/src/services/cacheWarmingService.js`**
   - Skips availability warming (since it's calculated on-demand)

## How It Works

```javascript
// Example usage
const availability = await tebraService.getAvailability({
  practiceId: '1',
  providerId: '1',
  fromDate: '2026-01-23',
  toDate: '2026-02-06',
  slotDuration: 30  // minutes
});

// Returns:
{
  availability: [
    {
      startTime: '2026-01-23T09:00:00Z',
      endTime: '2026-01-23T09:30:00Z',
      startDate: '2026-01-23',
      providerId: '1',
      practiceId: '1',
      duration: 30
    },
    // ... more slots
  ],
  totalCount: 45,
  fromDate: '2026-01-23',
  toDate: '2026-02-06',
  practiceId: '1',
  providerId: '1'
}
```

## Configuration

Availability calculation uses settings from the `availability_settings` table:

- **Business Hours**: Days and hours when appointments are available
- **Slot Duration**: Default 30 minutes (configurable)
- **Blocked Dates**: Dates when no appointments are available
- **Blocked Time Slots**: Specific time ranges that are blocked
- **Advance Booking Days**: Maximum days in advance for booking (default: 14)

## Performance Considerations

1. **Caching**: Results are cached using `cacheService` to avoid repeated calculations
2. **Date Range**: Limit date ranges to reasonable windows (e.g., 14 days) to avoid performance issues
3. **GetAppointments Calls**: May make multiple API calls if there are many appointments

## Limitations

1. **No Real-Time Availability**: Calculated based on existing appointments, not real-time calendar
2. **Provider Schedules**: Assumes providers are available during business hours (no individual schedules)
3. **Resource Conflicts**: Only checks appointment conflicts, not resource availability
4. **Performance**: May be slower than a native GetAvailability method would be

## Alternative Approaches

If this solution doesn't meet your needs, consider:

1. **Third-Party Scheduling**: Use a dedicated scheduling system (e.g., Calendly, Acuity) and sync with Tebra
2. **Custom Calendar**: Build a custom availability system outside of Tebra
3. **Tebra API Upgrade**: Check if newer Tebra API versions support GetAvailability
4. **Direct Calendar Integration**: Integrate with provider calendars (Google Calendar, Outlook) directly

## Testing

Test the availability calculation:

```bash
# Test via API endpoint
curl -X POST http://localhost:5000/api/tebra-appointment/get-availability \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "availabilityOptions": {
      "practiceId": "1",
      "providerId": "1",
      "fromDate": "2026-01-23",
      "toDate": "2026-02-06"
    }
  }'
```

## Troubleshooting

### Issue: No availability slots returned

**Possible causes:**
- All slots conflict with existing appointments
- Business hours are not configured
- Date range is outside advance booking window
- All dates are blocked

**Solution:**
- Check `availability_settings` table
- Verify business hours are enabled
- Check for blocked dates
- Review existing appointments

### Issue: Too many slots returned

**Possible causes:**
- Business hours are too wide
- Slot duration is too small
- No existing appointments to filter

**Solution:**
- Adjust business hours in settings
- Increase slot duration
- This is normal if there are few appointments

### Issue: Performance is slow

**Possible causes:**
- Large date range
- Many existing appointments
- Multiple API calls to GetAppointments

**Solution:**
- Reduce date range (e.g., 7-14 days)
- Enable caching
- Consider pagination for large result sets

## Future Improvements

1. **Caching Strategy**: Pre-calculate and cache availability for common date ranges
2. **Provider Schedules**: Support individual provider schedules
3. **Resource Availability**: Check resource availability in addition to appointments
4. **Real-Time Updates**: Update availability when appointments are created/cancelled
5. **Optimization**: Batch GetAppointments calls or use more efficient queries
